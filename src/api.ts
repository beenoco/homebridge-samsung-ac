import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { PlatformAccessory } from 'homebridge';

import { BeenocoSamsungAcPlatform } from './platform.js';
import { TLSLoadError, RequestError, RequestTimeoutError } from './errors.js';

export class BeenocoSamsungAcApi {

  private readonly tlsOptions : https.AgentOptions;

  constructor(
    private readonly platform: BeenocoSamsungAcPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    try {
      this.tlsOptions = {
        ca: fs.readFileSync(path.join(import.meta.dirname, '../tls/ca.pem')),
        cert: fs.readFileSync(path.join(import.meta.dirname, '../tls/cert.pem')),
        key: fs.readFileSync(path.join(import.meta.dirname, '../tls/key.pem')),
        ciphers: 'DEFAULT:@SECLEVEL=0', // allow weak encryption
      };
    } catch (e) {
      this.platform.log.error('Failed to load TLS files:', e);
      throw new TLSLoadError(String((e as Error).message || e));
    }
  }

  private options(method: string, resource: string, contentLength: number) : https.RequestOptions {
    return {
      hostname: this.platform.config.deviceIPAddress,
      port: 8888,
      path: '/devices/' + this.accessory.context.device.id + resource,
      method: method,
      rejectUnauthorized: false,
      secureProtocol: 'TLSv1_method',
      agent: new https.Agent(this.tlsOptions),
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
      const request = https.request(this.options(method, resource, content.length), (response) => {
        response.setEncoding('utf8');
        let rawData = '';
        const statusCode = response.statusCode;
        response.on('data', (chunk) => {
          rawData += chunk;
        });
        response.on('end', () => {
          if (statusCode && (statusCode < 200 || statusCode > 299)) {
            const err = new RequestError('Request error status code: ' + statusCode, statusCode, rawData);
            this.platform.log.error('Request returned error status', err.message, err.body);
            reject(err);
            return;
          }
          resolve(rawData);
        });
      });
      if (content.length > 0) {
        this.platform.log.debug('Sending:', content);
        request.write(content);
      }
      request.on('error', e => {
        this.platform.log.error('Request error', e);
        reject(e instanceof Error ? e : new RequestError(String(e)));
      });
      request.setTimeout(this.platform.config.requestTimeout || 10000, () => {
        const te = new RequestTimeoutError();
        this.platform.log.error('Request timed out');
        request.destroy(te);
      });
      request.end();
    });
  }

  async getDeviceStatus() : Promise<DeviceStatus> {
    const received = await this.request('GET');
    this.platform.log.debug('Received:', received);
    try {
      const response = JSON.parse(received) as DeviceResponse;
      return response.Device;
    } catch (e) {
      this.platform.log.error('Invalid JSON from device', e, received);
      throw new RequestError('Invalid JSON from device', undefined, received);
    }
  }

  private async put(resource: string, json: unknown) {
    return this.request('PUT', resource, json);
  }

  async putPower(value: Power) {
    return this.put('/operation', { 'Operation': { 'power': value } });
  }

  async putMode(value: Mode) {
    return this.put('/mode', { 'Mode': { 'modes': [value] } });
  }

  async putDesiredTemperature(value: number) {
    return this.put('/temperatures/0', { 'Temperature': { 'desired': value } });
  }

  async putWindSpeedLevel(value: WindSpeedLevel) {
    return this.put('/wind', { 'Wind': { 'speedLevel': value as number } });
  }
}

export const enum WindSpeedLevel {
  AUTO = 0,
  LOW = 4,
  MEDIUM = 3,
  HIGH = 2,
}

export const enum Mode {
  AUTO = 'Opmode_Auto',
  COOL = 'Opmode_Cool',
  DRY = 'Opmode_Dry',
  FAN = 'Opmode_Fan',
  HEAT = 'Opmode_Heat',
}

export const enum Power {
  OFF = 'Off',
  ON = 'On',
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
