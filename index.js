var http = require('http');
var request = require('request');
var fs = require('fs');
var ical = require('ical.js');
var url = require('url');
const config = require('./config.js');

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
 * [x] use the file name from the downloaded data, if present
 * [x] add config
 * - cleanup
 */


//
// Constants
//
var urlParamName='url';
var statusParamName = 'status';
var icalPath = 'calbolit';
var icalProtocolPrefix = 'webcal://';
var httpsProtocolPrefix = 'https://';
const calendarFileName = 'calendar.ics';

var dbgLogFile;

var LogDbg = function(msg) {
  if (!config.dbg.debugmode) {
    return;
  }
  if (config.dbg.writelog) {
    if (!dbgLogFile) {
      dbgLogFile = fs.createWriteStream(config.dbg.logfile);
    }
    dbgLogFile.write(msg + '\n');
  }
  console.log('dbg> ' + msg);
};

var LogErr = function(msg) {
  if (config.dbg.writelog) {
    if (!dbgLogFile) {
      dbgLogFile = fs.createWriteStream(config.dbg.logfile);
    }
    dbgLogFile.write('err> ' + msg + '\n');
  }
  console.log('err> ' + msg);
};

//
//
//
var download = function(url, callback) {
  LogDbg("Donloading: url="+url);

  // TODO: Add timeout
  // TODO: Limit size
  var options = {
    url: url,
    headers: {'User-Agent': config.app.userAgentString}
  };

  request(options, function(error, response, body) {
    LogDbg("Download done. statusCode=' + response.statusCode + '; message=' + response.statusMessage + '; Data.size=" + body.length);
    callback(body, response);
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
    var accept = onEvent(ev);
    if (!accept) {
      LogDbg("Removed: " + ev.getFirstPropertyValue("summary"));
      vevents.splice(i, 1);
      --i;
    }
    else {
      vcal.addSubcomponent(ev);
    }
  }

  return vcal;
}

function SendVCal(response, vcalStr, remoteHeaders) {
  var bytesLen = Buffer.byteLength(vcalStr, 'utf8');
  LogDbg("vcalStr.length="+vcalStr.length+"; bytesLen="+bytesLen);
  
  var fileName = calendarFileName;
  var contentHeader = remoteHeaders && remoteHeaders['content-disposition'];
  if (contentHeader) {
    const filenamePattern = ';filename=';
    var n = contentHeader.indexOf(filenamePattern);
    if (n != -1) {
      fileName = contentHeader.substring(n + filenamePattern.length);
      LogDbg('Using the remote file name: ' + fileName);
    }
  }

  var pragmaValue = remoteHeaders && remoteHeaders['pragma'];
  var cacheControlValue = remoteHeaders && remoteHeaders['cache-control'];
  
  response.writeHead(200, 
    {
    'Pragma': pragmaValue || 'no-cache',
    'Cache-Control': cacheControlValue || 'private, no-cache, no-store, must-revalidate',
    'Content-Type': 'text/calendar;charset=utf-8',
    'Content-Disposition': 'attachment;filename=' + fileName,
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

function endsWith(str, pattern) {
  return (str.lastIndexOf(pattern) + pattern.length == str.length);
}

function startsWith(str, pattern) {
  return str.indexOf(pattern) === 0;
}

function IsAllowedHost(hostname) {
  hostname = hostname.toLowerCase();
  for (var i = 0; i < config.domains.whitelist.length; i++) {
    var domain = config.domains.whitelist[i].toLowerCase();
    if (endsWith(hostname, domain)) {
      return true;
    }
  }
  return false;
}

function IsValidVcal(text) {
  return startsWith(text, 'BEGIN:VCALENDAR') && (text.indexOf('END:VCALENDAR') != -1);
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
    LogDbg('Host not allowed: ' + remoteURL.hostname);
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
        LogDbg('Exclude event because not accepted: ' + summary);
        return false;
      };
    }
    return true;
  };

  download(icalURL, function(data, remoteResponse) {
    // check if response is success
    if (remoteResponse.statusCode !== 200) {
      LogErr('Problem with remote response: statusCode=' + remoteResponse.statusCode+'; message=' + remoteResponse.statusMessage);
      res.writeHead(remoteResponse.statusCode, remoteResponse.statusMessage);
      res.end();
      return;
    };

    if (!IsValidVcal(data)) {
      LogErr('Invalid vcal data: >' + data.substring(0, config.dbg.trimoutput) + '<...');
      res.writeHead(remoteResponse.statusCode, remoteResponse.statusMessage);
      res.end(data);
      return;
    }

    var vcal = ProcessICAL(data, FilterEventFunc);
    var vcalStr = vcal.toString();
    SendVCal(res, vcalStr, remoteResponse.headers);
  });
}

if (config.dbg.debugmode) {
}
console.log('Running in '+(config.dbg.debugmode ? 'debug' : 'PROD')+' mode. Port=' + config.app.port);
http.createServer(HttpHandler).listen(config.app.port);
