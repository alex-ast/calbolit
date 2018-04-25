var http = require('http');
var request = require('request');
var fs = require('fs');
var ical = require('ical.js');
var url = require('url');

/*
 * Usage:
 * The 'url' param must be the last. Everything past url= is considered part of the URL to remote calendar.
 * 
 *  https://example.com/calbolit?url=https://www.facebook.com/ical/u.php?uid=123456789&key=AbCdEfGhIjKlMn
 *  https://example.com/calbolit?status=accepted&url=webcal://www.facebook.com/ical/u.php?uid=123456789&key=AbCdEfGhIjKlMn
 *
 * Limitations:
 *  Only facebook calendar URLs are allowed
 *  webcal:// is treated as httpS.
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
var testIcalUrl = 'https://www.facebook.com/ical/u.php?uid=123456789&key=AbCdEfGhIjKlMn';
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
var httpsProtocolPrefix = 'https://';

//
// Debug section
//

var IsDebugMode = true;
var LogToFile = true;
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
  response.writeHead(200, 
    {
    'Content-Type': 'text/calendar;charset=utf-8',
    'Content-Disposition': 'attachment;filename=calendar.ics',
    'Content-Length': bytesLen
    }
  );
  response.end(vcalStr);
}

function SendError(response, errCode, errStatus, errMsg) {
  response.writeHead(errCode, errStatus,  { 'Content-Type': 'text/plain' });
  if (errMsg) {
    response.write(errMsg);
  }
  response.end();
}

function SendNotFoundError(response, errMsg) {
  SendError(response, 404, 'Unrecognized path', errMsg);
}

function SendBadRequestError(response, errMsg) {
  SendError(response, 400, 'Malformed request', errMsg);
}

function SendAccessDeniedError(response, errMsg) {
  SendError(response, 403, 'Forbidden', errMsg);
}

function IsAllowedHost(hostname) {
  return true;
}

function HttpHandler(req, res) {
  var reqInfoTmp = url.parse(req.url);

  /*
   * Parsing the request URL. The url= parameter is always the last one.
   *    https://example.com/calbolit?status=accepted&url=webcal://www.facebook.com/ical/u.php?uid=123456789&key=AbCdEfGhIjKlMn
   */
  
  if (reqInfoTmp.pathname !== '/'+icalPath) {
    LogErr('Unrecognized path: ' + reqInfoTmp.pathname);
    SendNotFoundError(res);
    return;
  }

  var n = reqInfoTmp.search.indexOf(urlParamName+'=');
  if (n == -1) {
    LogErr('Malformed request: ' + req.url);
    SendBadRequestError(res, 'Malformed request, no '+urlParamName+' parameter found');
    return;
  }

  var myPart = reqInfoTmp.search.substring(1, n);
  var icalURL = reqInfoTmp.search.substring(n + (urlParamName+'=').length);

  // TODO: Replace and try HTTPS first and only fallback to http if HTTPS not available.
  // Replace webcal:// with https://
  if (icalURL.toLowerCase().indexOf(icalProtocolPrefix) == 0) {
    icalURL = httpsProtocolPrefix + icalURL.substring(icalProtocolPrefix.length); 
  }

  LogDbg('Remote URL to use: '+icalURL);
  
  var remoteURL = url.parse(icalURL);
  if (!IsAllowedHost(remoteURL.hostname)) {
    SendAccessDeniedError(res, 'Hostname not allowed: ' + remoteURL.hostname);
    return;
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

LogDbg('Running server on port='+PORT);
http.createServer(HttpHandler).listen(PORT);
