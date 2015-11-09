/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

var url = require('url');
var req = require('request');
var debug = require('debug')('node-soap');

var VERSION = require('../package.json').version;

/**
 * A class representing the http client
 * @param {Object} [options] Options object. It allows the customization of
 * `request` module
 *
 * @constructor
 */
function HttpClient(options) {
  options = options || {};
  this._request = options.request || req;
}

/**
 * Build the HTTP request (method, uri, headers, ...)
 * @param {String} rurl The resource url
 * @param {Object|String} data The payload
 * @param {Object} exheaders Extra http headers
 * @param {Object} exoptions Extra options
 * @returns {Object} The http request object for the `request` module
 */
HttpClient.prototype.buildRequest = function(rurl, data, exheaders, exoptions) {
  var curl = url.parse(rurl);
  var secure = curl.protocol === 'https:';
  var host = curl.hostname;
  var port = parseInt(curl.port, 10);
  var path = [curl.pathname || '/', curl.search || '', curl.hash || ''].join('');
  var method = data ? 'POST' : 'GET';
  var headers = {
    'User-Agent': 'node-soap/' + VERSION,
    'Accept': 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'none',
    'Accept-Charset': 'utf-8',
    'Connection': 'close',
    'Host': host + (isNaN(port) ? '' : ':' + port)
  };
  var attr;

  if (typeof data === 'string') {
    headers['Content-Length'] = Buffer.byteLength(data, 'utf8');
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  exheaders = exheaders || {};
  for (attr in exheaders) {
    headers[attr] = exheaders[attr];
  }

  var options = {
    uri: curl,
    method: method,
    headers: headers,
    followAllRedirects: true
  };

  if (headers.Connection === 'keep-alive') {
    options.body = data;
  }

  exoptions = exoptions || {};
  for (attr in exoptions) {
    options[attr] = exoptions[attr];
  }
  debug('Http request: %j', options);
  return options;
};

/**
 * Handle the http response
 * @param {Object} The req object
 * @param {Object} res The res object
 * @param {Object} body The http body
 * @param {Object} The parsed body
 */
HttpClient.prototype.handleResponse = function(req, res, body) {
  debug('Http response body: %j', body);
  if (typeof body === 'string') {
    // Remove any extra characters that appear before or after the SOAP
    // envelope.
    var match = body.match(/(?:<\?[^?]*\?>[\s]*)?<([^:]*):Envelope([\S\s]*)<\/\1:Envelope>/i);
    if (match) {
      body = match[0];
    }
  }
  return body;
};

/**
 * Handle the http Attachment response
 * @param {Object} The req object
 * @param {Object} res The res object
 * @param {Object} body The http body
 * @param {Object} The attachment List
 */
HttpClient.prototype.handleAttachmentResponse = function(req, res, body) {
  debug('Http response body: %j', body);
  var arr = [];
  if (typeof body === 'string') {
     if ((res !== undefined)&&(res !== null)&&(res.headers['content-type'] !== undefined)&&(res.headers['content-type'] !== null)) {
       var boundary = res.headers['content-type'].match(/boundary=\"([^\"]*)\"/i);
       
       if (boundary !== null){
        var partSplitter = '--'+boundary[1];
        var parts = body.split(partSplitter);
        var attachments = parts.filter(function(part){
          return part.indexOf("attachment") > 1;
        })
        
        attachments.forEach(function(attachment){
          var attachement_split = attachments[0].split(/\r\n\r\n/g);
         
          var headers = {};
          attachement_split[0].split(/\r\n/g).forEach(function(header){
            var headerName = header.split(':')[0];
            var headerValue = header.split(':')[1];
            if ((headerName !== undefined)&&(headerName !== null)&&(headerName !== '')){
              headerName= headerName.trim();
              if  ((headerValue !== undefined)&&(headerValue !== null)&&(headerValue !== '')){
              headerValue =headerValue.trim();
              }
              headers[headerName]=headerValue;
            }
          });

          var data = attachement_split[1];
          arr.push({headers:headers,data:data});
        })    
      }
    }
  }
  return arr;
};

HttpClient.prototype.request = function(rurl, data, callback, exheaders, exoptions) {
  var self = this;
  var options = self.buildRequest(rurl, data, exheaders, exoptions);
  var headers = options.headers;
  var req = self._request(options, function(err, res, body) {
    if (err) {
      return callback(err);
    }
    var attachments = self.handleAttachmentResponse(req, res, body);
    body = self.handleResponse(req, res, body);
    callback(null, res, body,attachments);
  });
  if (headers.Connection !== 'keep-alive') {
    req.end(data);
  }
  return req;
};

module.exports = HttpClient;
