import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { BeenocoSamsungAcPlatform } from './platform.js';
import * as API from './api.js';

export class BeenocoSamsungAcPlatformAccessory {

  private api : API.BeenocoSamsungAcApi;
  private service: Service;
  private fanService: Service;
  private deviceStatusPromise: Promise<API.DeviceStatus> | null = null;

  constructor(
    private readonly platform: BeenocoSamsungAcPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.config.deviceModel)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.platform.config.deviceMACAddress);

    this.service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Air Conditioner');
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .setProps({
        minValue: 16,
        maxValue: 30,
        minStep: 1,
      });

    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, 'Air Conditioner Fan');
    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleFanActiveGet.bind(this));
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.handleFanRotationSpeedGet.bind(this))
      .onSet(this.handleFanRotationSpeedSet.bind(this))
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 25,
      });

    this.api = new API.BeenocoSamsungAcApi(platform, accessory);

    setInterval(async () => {
      this.updateCharacteristics();
    }, this.platform.config.devicePollInterval * 1000);
  }

  async getDeviceStatus() : Promise<API.DeviceStatus> {
    if (!this.deviceStatusPromise) {
      const device = this.api.getDeviceStatus()
        .finally(() => {
          this.deviceStatusPromise = null;
        });
      this.deviceStatusPromise = device;
    }
    return this.deviceStatusPromise;
  }

  async updateCharacteristics() {
    const device = await this.getDeviceStatus();
    
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState,
      this.getCurrentState(device));
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState,
      this.getTargetState(device));
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature,
      device.Temperatures[0].current);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature,
      device.Temperatures[0].desired);

    this.fanService.updateCharacteristic(this.platform.Characteristic.Active,
      this.getFanActive(device));
    this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed,
      this.getFanRotationSpeed(device));
  }

  async handleTargetTemperatureGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = device.Temperatures[0].desired;
    this.platform.log.debug('Device target temperature', val);
    return val;
  }

  async handleCurrentHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = this.getCurrentState(device);
    this.platform.log.debug('Device current state', val);
    return val;
  }

  async handleTargetHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    return this.getTargetState(device);
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    this.platform.log.debug('Handling target heating cooling state set', value);
    if (value === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      await this.api.putPower(API.Power.OFF);
    } else {
      let mode = API.Mode.AUTO;
      if (value === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        mode = API.Mode.COOL;
      } else if (value === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
        mode = API.Mode.HEAT;
      }
      await this.api.putPower(API.Power.ON);
      await this.api.putMode(mode);
    }
    await this.updateCharacteristics();
  }

  async handleCurrentTemperatureGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    return device.Temperatures[0].current;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('Handling target temperature set', value);
    await this.api.putDesiredTemperature(value as number);
    await this.updateCharacteristics();
  }

  async handleTemperatureDisplayUnitsGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    return this.getUnit(device.Temperatures[0]);
  }

  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.platform.log.debug('Handling temperature display units set', value);
    const unit = value === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS ?
      API.Unit.CELSIUS : API.Unit.FAHRENHEIT;
    await this.api.putTemperatureUnit(unit);
    await this.updateCharacteristics();
  }

  async handleFanActiveGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = this.getFanActive(device);
    this.platform.log.debug('Device fan active', val);
    return val;
  }

  async handleFanRotationSpeedGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = this.getFanRotationSpeed(device);
    this.platform.log.debug('Device fan speed', val);
    return val;
  }

  async handleFanRotationSpeedSet(value: CharacteristicValue) {
    value = value as number;
    this.platform.log.debug('Handle fan rotation speed set', value);
    let speedLevel : API.WindSpeedLevel;
    if (value <= 25) {
      speedLevel = API.WindSpeedLevel.LOW;
    } else if (value <= 50) {
      speedLevel = API.WindSpeedLevel.MEDIUM;
    } else if (value <= 75) {
      speedLevel = API.WindSpeedLevel.HIGH;
    } else { 
      speedLevel = API.WindSpeedLevel.AUTO;
    }
    await this.api.putWindSpeedLevel(speedLevel);
    await this.updateCharacteristics();
  }

  getCurrentState(device : API.DeviceStatus) : CharacteristicValue {
    if (device.Operation.power === API.Power.ON && (device.Mode.modes[0] === API.Mode.COOL ||
      (device.Mode.modes[0] === API.Mode.AUTO &&
        device.Temperatures[0].desired < device.Temperatures[0].current))) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    } else if (device.Operation.power === API.Power.ON && (device.Mode.modes[0] === API.Mode.HEAT ||
      (device.Mode.modes[0] === API.Mode.AUTO &&
        device.Temperatures[0].desired > device.Temperatures[0].current))) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    } else {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  }

  getTargetState(device: API.DeviceStatus) : CharacteristicValue {
    if (device.Operation.power === API.Power.ON && device.Mode.modes[0] === API.Mode.COOL) {
      return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    } else if (device.Operation.power === API.Power.ON && device.Mode.modes[0] === API.Mode.HEAT) {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    } else if (device.Operation.power === API.Power.ON && device.Mode.modes[0] === API.Mode.AUTO) {
      return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
  }

  getUnit(temperature : API.TemperatureStatus) {
    return temperature.unit === API.Unit.CELSIUS ?
      this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS :
      this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
  }

  getFanActive(device: API.DeviceStatus) : CharacteristicValue {
    return device.Operation.power === API.Power.ON ?
      this.platform.Characteristic.Active.ACTIVE :
      this.platform.Characteristic.Active.INACTIVE;
  }

  getFanRotationSpeed(device: API.DeviceStatus) : CharacteristicValue {
    if (device.Operation.power === API.Power.ON) {
      switch (device.Wind.speedLevel) {
      case API.WindSpeedLevel.LOW:
        return 25;
      case API.WindSpeedLevel.MEDIUM:
        return 50;
      case API.WindSpeedLevel.HIGH:
        return 75;
      case API.WindSpeedLevel.AUTO:
        return 100;
      }
    }
    return 0;
  }

}
