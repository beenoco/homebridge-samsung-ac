import { HAPStatus, HapStatusError } from 'homebridge';

export class BeenocoError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'BeenocoError';
  }
}

export class TLSLoadError extends BeenocoError {
  constructor(message?: string) {
    super(message || 'Failed to load TLS files');
    this.name = 'TLSLoadError';
  }
}

export class RequestError extends BeenocoError {
  public readonly statusCode?: number;
  public readonly body?: string;

  constructor(message?: string, statusCode?: number, body?: string) {
    super(message || 'Request error');
    this.name = 'RequestError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class RequestTimeoutError extends RequestError {
  constructor(message?: string) {
    super(message || 'Request timed out');
    this.name = 'RequestTimeoutError';
  }
}

interface HAPModule {
  HapStatusError: typeof HapStatusError;
  HAPStatus: typeof HAPStatus;
}

export function toHapStatusError(hap: HAPModule): HapStatusError {
  // Map internal errors to a HAP status error. Keep mapping conservative.
  return new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
}
