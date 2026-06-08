import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { BeenocoSamsungAcPlatform } from './platform';
import * as API from './api';

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

    this.service = this.createService();
    this.fanService = this.createFanService();

    this.api = new API.BeenocoSamsungAcApi(platform, accessory);

    setInterval(async () => {
      const device = await this.getDeviceStatus();
      this.updateService(device);
      this.updateFanService(device);
    }, this.platform.config.devicePollInterval * 1000);
  }

  createService() : Service {
    const service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);
    service.setCharacteristic(
      this.platform.Characteristic.Name, 'Air Conditioner');
    service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));
    service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));
    service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));
    service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .setProps({
        minValue: 16,
        maxValue: 30,
        minStep: 1,
      });
    return service;
  }

  createFanService() : Service {
    const fanService = this.accessory.getService(this.platform.Service.Fan) ||
      this.accessory.addService(this.platform.Service.Fanv2);
    fanService.setCharacteristic(
      this.platform.Characteristic.Name, 'Air Conditioner Fan');
    fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleFanActiveGet.bind(this));
    fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.handleFanRotationSpeedGet.bind(this))
      .onSet(this.handleFanRotationSpeedSet.bind(this))
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 25,
      });
    fanService.getCharacteristic(this.platform.Characteristic.CurrentFanState)
      .onGet(this.handleFanCurrentStateGet.bind(this));
    return fanService;
  }

  updateService(device : API.DeviceStatus) {
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState,
      this.getCurrentState(device));
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState,
      this.getTargetState(device));
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature,
      device.Temperatures[0].current);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature,
      device.Temperatures[0].desired);
  }

  updateFanService(device : API.DeviceStatus) {
    this.fanService.updateCharacteristic(this.platform.Characteristic.Active,
      this.getFanActive(device));
    this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed,
      this.getFanRotationSpeed(device));
    this.fanService.updateCharacteristic(this.platform.Characteristic.CurrentFanState,
      this.getFanCurrentState(device));
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

  async handleTargetTemperatureGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = device.Temperatures[0].desired;
    this.platform.log.debug('Device desired temp: %i', val);
    return val;
  }

  async handleCurrentHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = this.getCurrentState(device);
    this.platform.log.debug('Device current state: %s', val);
    return val;
  }

  async handleTargetHeatingCoolingStateGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    return this.getTargetState(device);
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
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
  }

  async handleCurrentTemperatureGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    return device.Temperatures[0].current;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    await this.api.putDesiredTemperature(value as number);
  }

  async handleTemperatureDisplayUnitsGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    return this.getUnit(device.Temperatures[0]);
  }

  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    const unit = value === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS ?
      API.Unit.CELSIUS : API.Unit.FAHRENHEIT;
    await this.api.putTemperatureUnit(unit);
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

  async handleFanActiveGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = this.getFanActive(device);
    this.platform.log.debug('Device fan active: %s', val as string);
    return val;
  }

  async handleFanCurrentStateGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    return this.getCurrentState(device);
  }

  async handleFanRotationSpeedGet() : Promise<CharacteristicValue> {
    const device = await this.getDeviceStatus();
    const val = this.getFanRotationSpeed(device);
    this.platform.log.debug('Device fan speed: %d', val);
    return val;
  }

  async handleFanRotationSpeedSet(value: CharacteristicValue) {
    let speedLevel = API.WindSpeedLevel.AUTO;
    if (value === 25) {
      speedLevel = API.WindSpeedLevel.LOW;
    } else if (value === 50) {
      speedLevel = API.WindSpeedLevel.MEDIUM;
    } else if (value === 75) {
      speedLevel = API.WindSpeedLevel.HIGH;
    }
    this.platform.log.debug('Set fan speed level: %d', speedLevel);
    await this.api.putWindSpeedLevel(speedLevel);
  }

  getFanActive(device: API.DeviceStatus) : CharacteristicValue {
    return device.Operation.power === API.Power.ON ?
      this.platform.Characteristic.Active.ACTIVE :
      this.platform.Characteristic.Active.INACTIVE;
  }

  getFanCurrentState(device: API.DeviceStatus) : CharacteristicValue {
    return device.Operation.power === API.Power.ON ?
      this.platform.Characteristic.CurrentFanState.BLOWING_AIR :
      this.platform.Characteristic.CurrentFanState.INACTIVE;
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