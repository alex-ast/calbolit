var http = require('http');
//const https = require('https');
var request = require('request');
var fs = require('fs');
var ical = require('ical.js');
var url = require('url');


//
// Config section
//
var testIcalUrl = 'https://www.facebook.com/ical/u.php?uid=1821253602&key=AQCFykZOUBTQdpMF';
var tmpFile = 'tmp.ical';
var userAgentString = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36';
var icalParamName='ical';
var icalPath = 'calbolit';
var icalProtocolPrefix = 'webcal://';
var httpProtocolPrefix = 'http://';

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
    logFile.write(msg + '\n');
    console.log('dbg> ' + msg);
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
    
    // TODO: Add timeout
    // TODO: Limit size
    var options = { url: url, headers: {'User-Agent': userAgentString} };
    var req = request.get(options);

    // check for request error too
    req.on('error', function (err) {
        return cb(null, err.message);
    });

    if (IsDebugMode) {
        req.pipe(file);
    }

    req.on('response', function(response) {
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



function ProcessICAL(body) {
    LogDbg('ProcessICAL, body='+body);
    
    var jcal = ical.parse(body);
    var vcal = new ical.Component(jcal);
    var vevents = vcal.getAllSubcomponents('vevent');

    LogDbg("Events: " + vevents);
    
    vcal.removeAllSubcomponents("vevent");

    for (var i = 0; i < vevents.length; i++) {
        var ev = vevents[i];
        var summary = ev.getFirstPropertyValue("summary");
        var location = ev.getFirstPropertyValue("location");
        var url = ev.getFirstPropertyValue("url");
        var mystatus = ev.getFirstPropertyValue("partstat");
        
        LogDbg("Event, name=" + summary);
        LogDbg("\t\tlocation=" + location);
        LogDbg("\t\turl=" + url);
        LogDbg("\t\tGoing? " + mystatus);
        
        if (mystatus !== 'ACCEPTED') {
            LogDbg("Removed: " + summary);
        	vevents.splice(i, 1);
        	--i;
        }
        else {
            vcal.addSubcomponent(ev);
        }
    }
    
    return vcal;
}

function callback(error, response, body) {
  if (!error && response.statusCode == 200) {
    ProcessICAL(body);
  }
}

//request(options, callback);
/*
var icalData = fs.readFileSync('u1821253602.ics', {encoding: 'utf8'});

var ical = ProcessICAL(icalData);
LogDbg("====================");
LogDbg("New Events:");
LogDbg("" + ical.toString());
*/


http.createServer(function handler(req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    
    var reqInfoTmp = url.parse(req.url);
    if (reqInfoTmp.pathname == '/'+icalPath) {
    	var n = reqInfoTmp.search.indexOf(icalParamName+'=');
    	if (n == -1) {
    		// Malformed request.
	    	var myPart = reqInfoTmp.search.substring(1);
	    	var icalURL = "";
    	}
    	else {
	    	var myPart = reqInfoTmp.search.substring(1, n);
	    	var icalURL = reqInfoTmp.search.substring(n + (icalParamName+'=').length);
    	}
    	
    	// TODO: Replace and try HTTPS first and only fallback to http if HTTPS not available.
    	if (icalURL.toLowerCase().indexOf(icalProtocolPrefix) === 0) {
    		icalURL = httpProtocolPrefix + icalURL.substring(icalProtocolPrefix.length); 
    	}
    	var reqInfo = url.parse('/?' + myPart, true);
        res.write("myPart=" + myPart + '\n');
        res.write("icalURL=" + icalURL + '\n');

        download(icalURL);
    }
    
    res.end('Hello World zzz\n');
}).listen(1337, '127.0.0.1');
