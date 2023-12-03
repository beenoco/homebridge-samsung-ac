import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { BeenocoSamsungACPlatform } from './platform';

import fs = require('node:fs');
import https = require('node:https');
// const tls = require('node:tls');

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export class BeenocoSamsungACPlatformAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private exampleStates = {
    On: false,
    Temperature: 100,
  };

  constructor(
    private readonly platform: BeenocoSamsungACPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.config.deviceModel)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.platform.config.deviceMACAddress);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
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

    /**
     * Creating multiple services of the same type.
     *
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     *
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    // Example: add two "motion sensor" services to the accessory
    // const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');

    // const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');

    /**
     * Updating characteristics values asynchronously.
     *
     * Example showing how to update the state of a Characteristic asynchronously instead
     * of using the `on('get')` handlers.
     * Here we change update the motion sensor trigger states on and off every 10 seconds
     * the `updateCharacteristic` method.
     *
     */
    let motionDetected = false;
    setInterval(() => {
      // EXAMPLE - inverse the trigger
      motionDetected = !motionDetected;

      // push the new value to HomeKit
      // motionSensorOneService.updateCharacteristic(this.platform.Characteristic.MotionDetected, motionDetected);
      // motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);

      // this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
      // this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    }, this.platform.config.devicePollInterval * 1000);
  }

  options(method, resource, contentLength=0) : https.RequestOptions {
    const cert = fs.readFileSync(__dirname + '/../cert.pem');
    const agent = new https.Agent({
      cert: cert,
      key: cert,
      ciphers: 'DEFAULT:@SECLEVEL=0',
      // Optionally, you can also include the CA certificate (if required)
      // ca: fs.readFileSync('path/to/ca.crt'),
    });
    return {
      hostname: this.platform.config.deviceIPAddress,
      port: 8888,
      path: '/devices/' + this.accessory.context.device.id + resource,
      method: method,
      rejectUnauthorized: false,
      secureProtocol: 'TLSv1_method',
      agent: agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': contentLength,
        'Authorization': 'Bearer ' + this.platform.config.deviceToken,
      },
    };
  }

  // get(resource) : Promise<any> {
  //   return new Promise((resolve, reject) => {
  //     https.request(this.options('GET', resource), res => {
  //       let rawData = '';
  //       res.on('data', (chunk) => {
  //         rawData += chunk;
  //       });
  //       res.on('end', () => {
  //         try {
  //           resolve(JSON.parse(rawData));
  //         } catch (e : unknown) {
  //           reject(rawData);
  //         }
  //       });
  //     }).end();
  //   });
  // }

  request(method : string, resource='', json={}) : Promise<any> {
    let content = '';
    if (Object.keys(json).length) {
      content = JSON.stringify(json);
    }
    return new Promise((resolve, reject) => {
      const request = https.request(this.options(method, resource, content.length), res => {
        let rawData = '';
        this.platform.log.debug('Status code:', res.statusCode);
        // res.setEncoding('utf8');
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            this.platform.log.debug('Received: ', rawData);
            resolve(rawData.length ? JSON.parse(rawData) : '');
          } catch (e : unknown) {
            this.platform.log.debug('Rejecting: ', e);
            // reject(rawData);
          }
        });
      });
      this.platform.log.debug('Sent: ', content);
      request.write(content);
      request.end();
    });
  }

  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  async handleTargetTemperatureGet() : Promise<CharacteristicValue> {
    // this.platform.log.debug('Triggered GET TargetTemperature');
    return this.request('GET', '/temperatures/0').then((json) => {
      // this.platform.log.debug('JSON:', json);
      try {
        // this.platform.log.debug('Resolving with result:', json.Temperature.desired);
        return json.Temperature.desired;
      } catch (e : unknown) {
        throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

    // return new Promise((resolve, reject) => {
    //   https.request(this.options(), res => {
    //     // this.platform.log.debug('Status code:', res.statusCode);
    //     // res.setEncoding('utf8');
    //     let rawData = '';
    //     res.on('data', (chunk) => {
    //       rawData += chunk;
    //     });
    //     res.on('end', () => {
    //       try {
    //       // this.platform.log.debug('Raw data: ', rawData);
    //         const parsedData = JSON.parse(rawData);
    //         this.platform.log.debug('Parsed data', parsedData);
    //         this.platform.log.debug('Resolving with result:', parsedData.Temperature.desired);
    //         resolve(parsedData.Temperature.desired);
    //       } catch (e : any) {
    //         // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    //         reject(rawData);
    //         // console.error(e.message);
    //       }
    //     });
    //   }).end();
    // });
  }

  // /**
  //  * Handle "SET" requests from HomeKit
  //  * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
  //  */
  // async setOn(value: CharacteristicValue) {
  //   // implement your own code to turn your device on/off
  //   this.exampleStates.On = value as boolean;

  //   this.platform.log.debug('Set Characteristic On ->', value);
  // }

  // /**
  //  * Handle the "GET" requests from HomeKit
  //  * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
  //  *
  //  * GET requests should return as fast as possbile. A long delay here will result in
  //  * HomeKit being unresponsive and a bad user experience in general.
  //  *
  //  * If your device takes time to respond you should update the status of your device
  //  * asynchronously instead using the `updateCharacteristic` method instead.

  //  * @example
  //  * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
  //  */
  // async getOn(): Promise<CharacteristicValue> {
  //   // implement your own code to check if the device is on
  //   const isOn = this.exampleStates.On;

  //   this.platform.log.debug('Get Characteristic On ->', isOn);

  //   // if you need to return an error to show the device as "Not Responding" in the Home app:
  //   // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

  //   return isOn;
  // }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setTargetTemperature(value: CharacteristicValue) {
    // implement your own code to set the brightness
    this.exampleStates.Temperature = value as number;

    // this.platform.log.debug('Set Characteristic Temperature -> ', value);
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  handleCurrentHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    return this.request('GET').then((json) => {
      if (json.Device.Operation.power === 'On' && json.Device.Mode.modes[0] === 'Opmode_Cool') {
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      } else if (json.Device.Operation.power === 'On' && json.Device.Mode.modes[0] === 'Opmode_Heat') {
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      } else if (json.Device.Operation.power === 'On' && json.Device.Mode.modes[0] === 'Opmode_Auto') {
        return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
      } else {
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      }
    });
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    return this.request('GET').then((json) => {
      if (json.Device.Operation.power === 'On' && json.Device.Mode.modes[0] === 'Opmode_Cool') {
        return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
      } else if (json.Device.Operation.power === 'On' && json.Device.Mode.modes[0] === 'Opmode_Heat') {
        return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
      } else if (json.Device.Operation.power === 'On' && json.Device.Mode.modes[0] === 'Opmode_Auto') {
        return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
      } else {
        return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
      }
    });
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value) {
    try {
      if (value === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
        this.request('PUT', '/operation', {'Operation':{'power':'Off'}})
          .catch((reason) => this.platform.log.error('reason:', reason));
      } else {
        let mode = 'Opmode_Auto';
        if (value === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
          mode = 'Opmode_Cool';
        } else if (value === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
          mode = 'Opmode_Heat';
        }
        let result = await this.request('PUT', '/operation', {'Operation': {'power': 'On'}});
        this.platform.log.debug('REsult: ', result);
        result = await this.request('PUT', '/mode', {'Mode': {'modes': [mode]}});
        this.platform.log.debug('REsult: ', result);
      }
    } catch (e) {
      this.platform.log.error('error', e);
    }
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet() : Promise<CharacteristicValue> {
    return this.request('GET', '/temperatures/0').then((json) => {
      return json.Temperature.current;
    });
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value) {
    // this.platform.log.debug('Triggered SET TargetTemperature:', value);
    // const json = '"Temperature":{"desired":"' + value + '"}';
    const result = await this.request('PUT', '/temperatures/0', {'Temperature':{'desired':value}});
    this.platform.log.debug('Result : ', result);
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet() : Promise<CharacteristicValue> {
    // this.platform.log.debug('Triggered GET TemperatureDisplayUnits');
    return this.request('GET', '/temperatures/0').then((json) => {
      // this.platform.log.debug('JSON:', json);
      // try {
      // this.platform.log.debug('Resolving with result:', json);
      if (json.Temperature.unit === 'Celsius') {
        return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
      } else {
        return this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
      }
      // } catch (e : unknown) {
      //   throw new this.platform.api.hap.HapStatusError(
      //     this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      // }
    });
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsSet(value) {
    // this.platform.log.debug('Triggered SET TemperatureDisplayUnits:', value);
    let unit;
    switch (value){
      case this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS:
        unit = 'Celsius'; break;
      case this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT:
        unit = 'Fahrenheit'; break;
    }
    await this.request('PUT', '/temperatures/0/', {'Temperature':{'unit':unit}});
  }

}
