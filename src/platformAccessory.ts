import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { BeenocoSamsungACPlatform } from './platform';

import fs = require('node:fs');
import https = require('node:https');

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export class BeenocoSamsungACPlatformAccessory {
  private service: Service;
  private tlsCA: Buffer;
  private tlsCert: Buffer;
  private tlsKey: Buffer;

  constructor(
    private readonly platform: BeenocoSamsungACPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.config.deviceModel)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.platform.config.deviceMACAddress);

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(
      this.platform.Characteristic.Name, this.platform.config.name || 'Air Conditioner');

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    const tlsDir = __dirname + '/../tls';
    this.tlsCA = fs.readFileSync(tlsDir + '/ca.pem');
    this.tlsCert = fs.readFileSync(tlsDir + '/cert.pem');
    this.tlsKey = fs.readFileSync(tlsDir + '/key.pem');

    setInterval(async () => {
      try {
        const json = await this.request('GET');
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState,
          this.getCurrentState(json.Device));
        this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState,
          this.getTargetState(json.Device));
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature,
          json.Device.Temperatures[0].current);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature,
          json.Device.Temperatures[0].desired);
        this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits,
          this.getUnit(json.Device.Temperatures[0]));
      } catch(e) {
        if (e instanceof Error) {
          this.platform.log.error('Error from periodic update.', e.message);
        }
      }
    }, this.platform.config.devicePollInterval * 1000);
  }

  options(method: string, resource: string, contentLength: number) : https.RequestOptions {
    return {
      hostname: this.platform.config.deviceIPAddress,
      port: 8888,
      path: '/devices/' + this.accessory.context.device.id + resource,
      method: method,
      rejectUnauthorized: false,
      secureProtocol: 'TLSv1_method',
      agent: new https.Agent({
        ca: this.tlsCA,
        cert: this.tlsCert,
        key: this.tlsKey,
        ciphers: 'DEFAULT:@SECLEVEL=0',
      }),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': contentLength,
        'Authorization': 'Bearer ' + this.platform.config.deviceToken,
      },
    };
  }

  /**
   * Send a request to the device
   * @param method the HTTP method to use for the request
   * @param resource the resource to be appended to the device URI
   * @param json the JSON to send in the body of the request, may be empty
   * @returns a promise resolving to the JSON result, may be empty
   */
  request(method: string, resource='', json={}) : Promise<any> {
    let content = '';
    if (Object.keys(json).length) {
      content = JSON.stringify(json);
    }
    return new Promise((resolve, reject) => {
      const request = https.request(
        this.options(method, resource, content.length), (response) => {
          response.setEncoding('utf8');
          if (response.statusCode && (response.statusCode < 200 || response.statusCode > 299)) {
            reject(new Error('Request error status code: ' + response.statusCode));
          }
          let rawData = '';
          response.on('data', (chunk) => {
            rawData += chunk;
          });
          response.on('end', () => {
            try {
              resolve(rawData.length > 0 ? JSON.parse(rawData) : {});
            } catch (e) {
              reject(new Error('Error processing raw data: ' + rawData));
            }
          });
        });
      // try {
      if (content.length > 0) {
        // this.platform.log.debug('Sending:', content);
        request.write(content);
      }
      request.on('error', e => {
        // this.platform.log.error('Error', e);
        reject(e);
      });
      request.end();
    });
  }

  async handleTargetTemperatureGet() : Promise<CharacteristicValue> {
    try {
      const json = await this.request('GET', '/temperatures/0');
      return json.Temperature.desired;
    } catch (e) {
      if (e instanceof Error) {
        this.platform.log.error('Get target temperature failed.', e.message);
      }
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleCurrentHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    try {
      const json = await this.request('GET');
      return this.getCurrentState(json.Device);
    } catch (e) {
      if (e instanceof Error) {
        this.platform.log.error('Get current heating/cooling state failed.', e.message);
      }
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleTargetHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    try {
      const json = await this.request('GET');
      return this.getTargetState(json.Device);
    } catch (e) {
      if (e instanceof Error) {
        this.platform.log.error('Get target heating/cooling state failed.', e.message);
      }
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    try {
      if (value === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
        await this.request('PUT', '/operation', {'Operation':{'power':'Off'}})
          .catch((reason) => this.platform.log.error('reason:', reason));
      } else {
        let mode = 'Opmode_Auto';
        if (value === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
          mode = 'Opmode_Cool';
        } else if (value === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
          mode = 'Opmode_Heat';
        }
        await this.request('PUT', '/operation', {'Operation': {'power': 'On'}});
        await this.request('PUT', '/mode', {'Mode': {'modes': [mode]}});
      }
    } catch (e) {
      if (e instanceof Error) {
        this.platform.log.error('Set target heating/cooling state failed.', e.message);
      }
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleCurrentTemperatureGet() : Promise<CharacteristicValue> {
    try {
      const json = await this.request('GET', '/temperatures/0');
      return json.Temperature.current;
    } catch (e) {
      if (e instanceof Error) {
        this.platform.log.error('Get current temperature failed.', e.message);
      }
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    try {
      await this.request('PUT', '/temperatures/0', {'Temperature': {'desired': value}});
    } catch {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleTemperatureDisplayUnitsGet() : Promise<CharacteristicValue> {
    try {
      const json = await this.request('GET', '/temperatures/0');
      return this.getUnit(json.Temperature);
    } catch (e) {
      if (e instanceof Error) {
        this.platform.log.error('Get temperature units failed.', e.message);
      }
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    try {
      const unit = value === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS ?
        'Celsius' : 'Fahrenheit';
      await this.request('PUT', '/temperatures', {'Temperature': {'unit': unit}})
        .catch((e) => this.platform.log.error(e));
    } catch (e) {
      if (e instanceof Error) {
        this.platform.log.error('Set temperature units failed.', e.message);
      }
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  getCurrentState(jsonDevice) : CharacteristicValue {
    if (jsonDevice.Operation.power === 'On' && (jsonDevice.Mode.modes[0] === 'Opmode_Cool' ||
      (jsonDevice.Mode.modes[0] === 'Opmode_Auto' &&
        jsonDevice.Temperatures[0].desired < jsonDevice.Temperatures[0].current))) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    } else if (jsonDevice.Operation.power === 'On' && (jsonDevice.Mode.modes[0] === 'Opmode_Heat' ||
      (jsonDevice.Mode.modes[0] === 'Opmode_Auto' &&
        jsonDevice.Temperatures[0].desired > jsonDevice.Temperatures[0].current))) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    } else {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  }

  getTargetState(jsonDevice) : CharacteristicValue {
    if (jsonDevice.Operation.power === 'On' && jsonDevice.Mode.modes[0] === 'Opmode_Cool') {
      return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    } else if (jsonDevice.Operation.power === 'On' && jsonDevice.Mode.modes[0] === 'Opmode_Heat') {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    } else if (jsonDevice.Operation.power === 'On' && jsonDevice.Mode.modes[0] === 'Opmode_Auto') {
      return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
  }

  getUnit(jsonTemperature) {
    return jsonTemperature.unit === 'Celsius' ?
      this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS :
      this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
  }

}