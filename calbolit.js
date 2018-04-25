var http = require('http');
var request = require('request');
var fs = require('fs');
var ical = require('ical.js');
var url = require('url');

/*
 * Usage:
 *  https://example.com/calbolit?url=https://www.facebook.com/ical/u.php?uid=1821253602&key=AQCFykZOUBTQdpMF
 *  https://example.com/calbolit?status=accepted&url=https://www.facebook.com/ical/u.php?uid=1821253602&key=AQCFykZOUBTQdpMF
 *  
 */

//
// Config section
//
var testIcalUrl = 'https://www.facebook.com/ical/u.php?uid=1821253602&key=AQCFykZOUBTQdpMF';
var tmpFile = 'tmp.ical';
var userAgentString = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36';

const PORT = process.env.PORT || 1337;
//
// Constants
//
var urlParamName='url';
var statusParamName = 'status';
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

var LogErr = function(msg) {
    if (!logFile) {
        logFile = fs.createWriteStream(LogFileName);
    }
    logFile.write('err> ' + msg + '\n');
    console.log('err> ' + msg);
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
    var options = {
        url: url,
        headers: {'User-Agent': userAgentString}
    };

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



function ProcessICAL(body, onlyAccepted) {
    LogDbg('ProcessICAL, body='+body);

    var jcal = ical.parse(body);
    var vcal = new ical.Component(jcal);
    var vevents = vcal.getAllSubcomponents('vevent');

    vcal.removeAllSubcomponents("vevent");

    for (var i = 0; i < vevents.length; i++) {
        var ev = vevents[i];
        var summary = ev.getFirstPropertyValue("summary");
        var location = ev.getFirstPropertyValue("location");
        var url = ev.getFirstPropertyValue("url");
        var mystatus = ev.getFirstPropertyValue("partstat");

        if (onlyAccepted && mystatus !== 'ACCEPTED') {
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


http.createServer(function handler(req, res) {
    var reqInfoTmp = url.parse(req.url);
    
    if (reqInfoTmp.pathname == '/'+icalPath) {

        var n = reqInfoTmp.search.indexOf(urlParamName+'=');
        if (n == -1) {
            // Malformed request.
            LogErr('Malformed request: ' + req.url);
            var vcalStr = 'BEGIN:VCALENDAR\nX-ERROR:Malformed request, no webcal parameter found ('+urlParamName+')\nEND:VCALENDAR';
            res.writeHead(200, {'Content-Type': 'text/calendar;charset=utf-8', 'Content-Disposition': 'attachment;filename=calendar.ics', 'Content-Length': vcalStr.length});
            res.end(vcalStr);
            return;
        }

        var myPart = reqInfoTmp.search.substring(1, n);
        var icalURL = reqInfoTmp.search.substring(n + (urlParamName+'=').length);
        LogDbg('icalURL='+icalURL);


        // TODO: Replace and try HTTPS first and only fallback to http if HTTPS not available.
        if (icalURL.toLowerCase().indexOf(icalProtocolPrefix) === 0) {
            icalURL = httpProtocolPrefix + icalURL.substring(icalProtocolPrefix.length); 
        }
  
        var reqInfo = url.parse('/?' + myPart, true);
        var onlyAccepted = ('accepted' === reqInfo.query[statusParamName]);

        LogDbg('Processing iCal. Only accepted? ' + onlyAccepted + '; URL=' + icalURL);
        download(icalURL, function(data, errMsg) {
            if (errMsg) {
                //
            }
            var vcal = ProcessICAL(data, onlyAccepted);
            var vcalStr = vcal.toString();
            res.writeHead(200, {'Content-Type': 'text/calendar;charset=utf-8', 'Content-Disposition': 'attachment;filename=calendar.ics', 'Content-Length': vcalStr.length});
            res.end(vcalStr);
        });
    }
    else {
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Hello World zzz\n');
    }
}).listen(PORT, '127.0.0.1');
