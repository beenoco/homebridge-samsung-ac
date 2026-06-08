import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { PlatformAccessory } from 'homebridge';

import { BeenocoSamsungAcPlatform } from './platform.js';

export class BeenocoSamsungAcApi {

  private tlsCA: Buffer;
  private tlsCert: Buffer;
  private tlsKey: Buffer;

  constructor(
    private readonly platform: BeenocoSamsungAcPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const tlsDir = path.join(import.meta.dirname, '../tls');
    this.tlsCA = fs.readFileSync(path.join(tlsDir, 'ca.pem'));
    this.tlsCert = fs.readFileSync(path.join(tlsDir, 'cert.pem'));
    this.tlsKey = fs.readFileSync(path.join(tlsDir, 'key.pem'));
  }

  private options(method: string, resource: string, contentLength: number) : https.RequestOptions {
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
     * @param content the content to send in the body of the request, may be empty
     * @returns a promise resolving to the string response, may be empty
     */
  private async request(method: string, resource='', json: unknown = null) : Promise<string> {
    const content = json ? JSON.stringify(json) : '';
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
            if (rawData) {
              this.platform.log.debug('Received:', rawData);
            }
            resolve(rawData);
          });
        });
      if (content.length > 0) {
        this.platform.log.debug('Sending:', content);
        request.write(content);
      }
      request.on('error', e => {
        this.platform.log.error('Error', e);
        reject(e);
      });
      request.end();
    });
  }

  async getDeviceStatus() : Promise<DeviceStatus> {
    const received = await this.request('GET')
      .catch(e => {
        if (e instanceof Error) {
          this.platform.log.error('Request status failed: {}', e.message);
        }
        throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      });
    const response : DeviceResponse = JSON.parse(received);
    return response.Device;
  }

  private async put(resource: string, json: unknown) {
    return this.request('PUT', resource, json);
  }

  async putPower(value: string) {
    return this.put('/operation', { 'Operation': { 'power': value } });
  }

  async putMode(value: Mode) {
    return this.put('/mode', { 'Mode': { 'modes': [value] } });
  }

  async putDesiredTemperature(value: number) {
    return this.put('/temperatures/0', { 'Temperature': { 'desired': value } });
  }

  async putTemperatureUnit(value: string) {
    return this.put('/temperatures', { 'Temperature': { 'unit': value } });
  }

  async putWindSpeedLevel(value: WindSpeedLevel) {
    return this.put('/wind', { 'Wind': { 'speedLevel': value as number } });
  }
}

export declare const enum WindSpeedLevel {
  AUTO = 0,
  LOW = 4,
  MEDIUM = 3,
  HIGH = 2
}

export declare const enum Mode {
  AUTO = 'Opmode_Auto',
  COOL = 'Opmode_Cool',
  DRY = 'Opmode_Dry',
  FAN = 'Opmode_Fan',
  HEAT = 'Opmode_Heat'
}

export declare const enum Power {
  OFF = 'Off',
  ON = 'On'
}

export declare const enum Unit {
  CELSIUS = 'Celsius',
  FAHRENHEIT = 'Fahrenheit'
}

export interface AlarmStatus {
  alarmType: string;
  code: string;
  id: string;
  triggeredTime: string;
}

export interface LinkStatus {
  href: string;
}

export interface ModeStatus {
  modes: Mode[];
  options: string[];
  supportedModes: Mode[];
}

export interface OperationStatus {
  power: Power;
}

export interface TemperatureStatus {
  current: number;
  desired: number;
  id: string;
  increment: number;
  maximum: number;
  minimum: number;
  name: string;
  unit: string;
}

export interface WindStatus {
  direction: string;
  speedLevel: WindSpeedLevel;
  supportedWindModes: string[];
}

export interface DeviceStatus {
  Alarms: AlarmStatus[];
  ConfigurationLink: LinkStatus;
  InformationLink: LinkStatus;
  Mode: ModeStatus;
  Operation: OperationStatus;
  Temperatures: TemperatureStatus[];
  Wind: WindStatus;
  description: string;
  id: string;
  name: string;
  resources: string[];
  type: string;
  uuid: string;
}

export interface DeviceResponse {
  Device: DeviceStatus;
}
