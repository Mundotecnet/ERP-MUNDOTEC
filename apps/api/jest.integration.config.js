/* eslint-env node */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/test/integration/**/*.int.spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 120000, // testcontainers tarda en levantar la primera vez
  // Por defecto Jest paraleliza por suite, lo que duplica containers en
  // máquinas con poca RAM. --runInBand desde el script lo evita.
};
