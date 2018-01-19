/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

var url = require('url');
var req = require('request');
var _ = require('lodash');
var debug = require('debug')('node-soap');
var uuid = require('uuid/v4');

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
  exoptions = exoptions || {};
  var attachments = exoptions.attachments || {};

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
  var multipart;
  exheaders = exheaders || {};
  for (attr in exheaders) {
    headers[attr] = exheaders[attr];
  }
  if (typeof data === 'string' && _.isEmpty(attachments)) {
    headers['Content-Length'] = Buffer.byteLength(data, 'utf8');
  }
  else if(!_.isEmpty(attachments)) {
    var start = uuid();
    delete headers.SOAPAction;
    headers['content-type'] =
      'multipart/related; boundary='+uuid()+'; type="application/soap+xml"; start="<'+start+'>"';
    multipart = [{
      'content-type': 'application/soap+xml; charset=UTF-8',
      'content-transfer-encoding': '8bit',
      'content-id': '<'+start+'>',
      body: data
    }];
    _.forOwn(attachments, function(val, key) {
      multipart.push({
        'content-transfer-encoding': 'binary',
        'content-id': '<' + key + '>',
        body: val
      });
    });

  }

  var options = {
    uri: curl,
    method: method,
    headers: headers,
    followAllRedirects: true,
    encoding: null,
    multipart: multipart
  };

  if (_.isEmpty(attachments) && headers.Connection === 'keep-alive') {
    options.body = data;
  }

  for (attr in _.omit(exoptions, ['attachments'])) {
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
 * Handle the http Multipart response
 * @param {Object} The req object
 * @param {Object} res The res object
 * @param {Object} body The http body
 * @param {Object} The parts List
 */
HttpClient.prototype.handleMultipart = function(req, res, body) {
  debug('Http response body: %j', body);
  var arr = [];
  if (typeof body === 'string') {
    if (res && res.headers['content-type']) {
      var boundary = res.headers['content-type'].match(/boundary=\"([^\"]*)\"/i);

      if (boundary){
        var partSplitter = '--'+boundary[1];
        var parts = body.split(partSplitter);
        parts.forEach(function(attachment){
          var bodyIndex = attachment.search(/\r\n\r\n/g);
          var headerPart = attachment.substring(0, bodyIndex);

          var headers = {};
          headerPart.split(/\r?\n/g).forEach(function(header){
            var headerName = header.split(':')[0];
            var headerValue = header.split(':')[1];
            if (headerName){
              headerName= headerName.trim();
              if  ((headerValue !== undefined)&&(headerValue !== null)&&(headerValue !== '')){
                headerValue =headerValue.trim();
              }
              headers[headerName]=headerValue;
            }
          });

          var data = attachment.substring(bodyIndex + 4);
          arr.push({headers:headers,data:data});
        });
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
    var binaryBody = body.toString('binary');
    var textBody = body.toString('utf8');
    var parts = self.handleMultipart(req, res, binaryBody);
    var attachments = parts.filter(function(part) {
      var contentDisposition = _.find(part.headers, function(val, key) {
        return key && (key.toLowerCase() === 'content-disposition');
      });
      return (contentDisposition || '').indexOf('attachment') !== -1;
    });
    textBody = self.handleResponse(req, res, textBody);
    callback(null, res, textBody, attachments, parts);
  });
  if (_.isEmpty((exoptions || {}).attachments) && headers.Connection !== 'keep-alive') {
    req.end(data);
  }
  return req;
};

module.exports = HttpClient;
