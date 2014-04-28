var util = require('util');
var utils = require('./utils.js');
var fs = require('fs');
var path = require('path');
var winston = require('winston');

var HealthLogger = require('./health_logger.js');

//---------------------------------------------------------------------------

function Profile(profileName, profilePath) {
  var self = this;

  self.name = profileName;
  self.path = profilePath;

  var _configFile = path.join(profilePath, 'config.json');
  var _configFileLoaded = false;
  var _config = {
    name: profileName
  };

  var _logFilePath = path.join(profilePath, 'logs');

  utils.mkdir(self.path, function(err) {
    if (err) { console.error(err); }

    // TODO... fix this
  });

  /* -------------------------- PUBLIC METHODS -------------------------- */

  self.getConfigSection = function(name, cb) {
    if (!_configFileLoaded) {
      self.loadConfig(function(err) {
        if (err) { return cb(err); }

        cb(null, _config[name]);
      });
    } else {
      cb(null, _config[name]);
    }
  };

  //---------------------------------------------------------------------------

  self.setConfigSection = function(name, data, cb) {
    _config[name] = data;
    self.saveConfig(cb);
  };

  //---------------------------------------------------------------------------

  self.loadConfig = function(cb) {
    fs.readFile(_configFile, 'utf8', function (err, data) {
      if (err) { return cb(err); }
      try {
        _config = JSON.parse(data);
      } catch (err) {
        return cb(err);
      }
      _configFileLoaded = true;
      cb(null);
    });
  };

  //---------------------------------------------------------------------------

  self.saveConfig = function(cb) {
    fs.writeFile(_configFile, JSON.stringify(_config, null, '\t'), 'utf8', function (err) {
      if (err) { return cb(err); }
      cb(null);
    });
  };

  /* -------------------------- LOGGER -------------------------- */

  utils.mkdir(_logFilePath, function(err) {
    if (err) { console.error(err); }

    var _logger = new(winston.Logger)({
      exitOnError: false,
      transports: [
        new (winston.transports.Console)({
          level: 'info',
          colorize: true,
          timestamp: function () { return util.format("%s - %s >",new Date().format("yyyy-MM-dd h:mm:ss"), self.name); }
        }),
        new(winston.transports.File)({
          level: 'debug',
          filename: 'profile.log',
          dirname: _logFilePath,
          maxSize: 1024*1024,
          maxFiles: 10,
          json: false,
          timestamp: function () { return new Date().format("yyyy-MM-dd h:mm:ss"); }
        })
      ]
    });
    _logger.extend(self);

    self.info('Profile \'%s\'', profileName);

    var _healthLogger = new HealthLogger(_logFilePath);
    _healthLogger.start();
  });
}

//---------------------------------------------------------------------------

module.exports = Profile;
