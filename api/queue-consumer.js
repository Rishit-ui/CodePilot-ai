'use strict';

const path = require('node:path');
const { loadConfig } = require('../src/config');
const { buildQueueConsumer } = require('../src/queue/consumer');

const config = loadConfig(path.resolve(__dirname, '..'));
const handler = buildQueueConsumer(config);

module.exports = handler;
module.exports.default = handler;
