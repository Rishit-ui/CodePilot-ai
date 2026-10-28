// Vercel Serverless Function entry point for CodePilot AI
const serverlessHandler = require('../src/server');

module.exports = serverlessHandler;
module.exports.default = serverlessHandler;
