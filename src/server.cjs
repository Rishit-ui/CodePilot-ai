// CommonJS entry point compatibility alias for Vercel Serverless Functions
const serverlessHandler = require('./server.js');

module.exports = serverlessHandler;
module.exports.default = serverlessHandler;
