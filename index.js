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

/*
 * TODO:
 * - add auth param so only authorized users can use it
 * - limit the size of calendar being downloaded
 * - (?) only accept 'Content-type: text/calendar'
 * - use the file name from the downloaded data, if present
 * - add config
 * - cleanup
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

var IsDebugMode = false;
var LogToFile = false;
var LogFileName = 'calbolit.log';
var logFile;

var LogDbg = function(msg) {
    if (!IsDebugMode) {
        return;
    }
    if (LogToFile) {
        if (!logFile) {
            logFile = fs.createWriteStream(LogFileName);
        }
        logFile.write(msg + '\n');
    }
    console.log('dbg> ' + msg);
};

var LogErr = function(msg) {
    if (LogToFile) {
        if (!logFile) {
            logFile = fs.createWriteStream(LogFileName);
        }
        logFile.write('err> ' + msg + '\n');
    }
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
    
    request(options, function(error, response, body) {
        // check if response is success
        if (response.statusCode !== 200) {
            LogErr('Response status=' + response.statusCode);
            return cb(null, 'Response status is ' + response.statusCode);
        };
        LogDbg("Download: done. Data.size=" + body.length);
        cb(body, null);
    });
};



function ProcessICAL(body, onEvent) {
    LogDbg('ProcessICAL, body:');
    //LogDbg('>>>');
    //LogDbg(body);
    //LogDbg('<<<');

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

        var accept = onEvent(ev);
        if (!accept) {
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

function SendVCal(response, vcalStr) {
    var bytesLen = Buffer.byteLength(vcalStr, 'utf8');
    LogDbg("vcalStr.length="+vcalStr.length+"; bytesLen="+bytesLen);
    //LogDbg(">>>");
    //LogDbg(vcalStr);
    //LogDbg("<<<");
    response.writeHead(200, 
        {
        'Content-Type': 'text/calendar;charset=utf-8',
        'Content-Disposition': 'attachment;filename=calendar.ics',
        'Content-Length': bytesLen
        }
    );
    response.end(vcalStr);
}

LogDbg('Running server on port='+PORT);

http.createServer(function handler(req, res) {
    var reqInfoTmp = url.parse(req.url);
    
    if (reqInfoTmp.pathname == '/'+icalPath) {

        var n = reqInfoTmp.search.indexOf(urlParamName+'=');
        if (n == -1) {
            // Malformed request.
            LogErr('Malformed request: ' + req.url);
            var vcalStr = 'BEGIN:VCALENDAR\nX-ERROR:Malformed request, no webcal parameter found ('+urlParamName+')\nEND:VCALENDAR';
            SendVCal(res, vcalStr);
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

        var FilterEventFunc = function(ev) {
            var summary = ev.getFirstPropertyValue("summary");
            if (onlyAccepted) {
                var mystatus = ev.getFirstPropertyValue("partstat");
                if (mystatus !== 'ACCEPTED') {
                    LogDbg('Exclude because not accepted: ' + summary);
                    return false;
                };
            }
            return true;
        };
        
        download(icalURL, function(data, errMsg) {
            if (errMsg) {
                //
            }
            var vcal = ProcessICAL(data, FilterEventFunc);
            var vcalStr = vcal.toString();
            SendVCal(res, vcalStr);
        });
    }
    else {
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Hello World\n');
    }
}).listen(PORT);
