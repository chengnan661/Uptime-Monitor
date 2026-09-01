import yaml from 'js-yaml';
import configRaw from '../config.yaml';
import { ConfigSchema, type Config } from './types';

export function loadConfig(): Config {
  try {
    const parsed = yaml.load(configRaw);
    return ConfigSchema.parse(parsed);
  } catch (e) {
    console.error('Failed to load configuration:', e);
    throw new Error('Configuration error');
  }
}
