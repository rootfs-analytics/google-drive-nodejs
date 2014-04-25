var utils = require('./utils.js');
var fs = require('fs');
var path = require('path');

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

  /* -------------------------- PUBLIC METHODS -------------------------- */

  self.getConfigSection = function(name, cb) {
    if (!_configFileLoaded) {
      self.loadConfig(function(err){
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
    utils.mkdir(self.path, function(err) {
      if (err) { return cb(err); }

      fs.writeFile(_configFile, JSON.stringify(_config, null, '\t'), 'utf8', function (err) {
        if (err) { return cb(err); }
        cb(null);
      });
    });
  };
}

//---------------------------------------------------------------------------

module.exports = Profile;
