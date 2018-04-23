var http = require('http');
//const https = require('https');
var request = require('request');
var fs = require('fs');
var ical = require('ical.js'); 

//
// Config section
//
var url = 'https://www.facebook.com/ical/u.php?uid=1821253602&key=AQCFykZOUBTQdpMF';
var tmpFile = 'tmp.ical';

//
// Debug section
//

var IsDebugMode = true;
var LogFileName = 'calbolit.log';
var logFile;

var LogDbg = function(msg) {
    if (!logFile) {
        logFile = fs.createWriteStream(LogFileName);
    }
    logFile.write(msg);
    console.log("dbg> " + msg);
};


//
//
//
var download = function(url, cb) {
    LogDbg("Donloading: url="+url);

    if (IsDebugMode) {
        var file = fs.createWriteStream(tmpFile);
    }

    var data = "";
    var req = request.get(url);

    // check for request error too
    req.on('error', function (err) {
        return cb(null, err.message);
    });

    if (IsDebugMode) {
        req.pipe(file);
    }

    req.on('response', function(response) {

        //if (response.statusCode == 301 || response.statusCode == 302) {
        //     LogDbg("Got redirect to: " + response.headers.location);
        //     download(response.headers.location, cb);
        //     return;
        //}

        // check if response is success
        if (response.statusCode !== 200) {
            return cb(null, 'Response status is ' + response.statusCode);
        }

        response.on('data', function(chunk) {
          LogDbg("Download: got data chunk: "); // + chunk);
          data += chunk;
        });

        response.on('end', function() {
          LogDbg("Download: done");
          cb(data, null);
        });
    });

    //req.setTimeout(10000, function () {
    //    request.abort();
    //});

};

var cb = function(data, err) {
    if (data !== null) {
        LogDbg("Have data: "); // + data)
    }
    else {
        LogDbg("Have error: " + err)
    }
};

LogDbg('URL=' + url);
//download(url, cb);


var options = {
  url: url,
  headers: {
    'User-Agent': 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36'
  }
};


function callback(error, response, body) {
  if (!error && response.statusCode == 200) {
    LogDbg("Got response.");

    var jcal = ical.parse(body);
    var vcal = new ical.Component(jcal);
    var vevents = vcal.getAllSubcomponents("vevent");

    LogDbg("Events: " + vevents);

    for (var i = 0; i < vevents.length; i++) {
        var ev = vevents[i];
        var summary = ev.getFirstPropertyValue("summary");
        var
        LogDbg("Event, name=" + summary);
    }
  }
}

request(options, callback);

http.createServer(function handler(req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Hello World\n');
}).listen(1337, '127.0.0.1');
