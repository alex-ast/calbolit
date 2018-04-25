const config = {
app: {
  port: parseInt(process.env.PORT) || 1337,
  userAgentString: 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36'
},
domains: {
  whitelist: ['facebook.com']
},
auth: {
  // echo 1 | sha1sum | head -c 7
  keys: ['70697bc']
},
dbg: {
  debugmode: process.env.NODE_ENV == 'dev',
  writelog: process.env.NODE_ENV == 'dev',
  logfile: 'calbolit.log'
},
};

module.exports = config;
