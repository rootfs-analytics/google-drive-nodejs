var utils = require('./utils.js');

var googleapis = require('googleapis');

function GoogleAuth(profile) {
  var self = this;

  var AUTH_REDIRECT_URL = 'urn:ietf:wg:oauth:2.0:oob';

  var CONFIG_SECTION = 'google_auth';
  var _config = {};

  //self.auth = {};

  /* -------------------------- PUBLIC METHODS -------------------------- */

  self.load = function(cb) {
    profile.getConfigSection(CONFIG_SECTION, function(err, data) {
      if (err) { return cb(err); }
      if (!data || !data.client_id || !data.client_secret || !data.credentials) {
        return cb(new Error('GoogleAuth config section for profile \'' + profile.name + '\' is missing or invalid.'));
      }

      _config = data;
      self.auth = new googleapis.OAuth2Client(_config.client_id, _config.client_secret, AUTH_REDIRECT_URL);
      self.auth.setCredentials(_config.credentials);
      utils.logWithTimestamp('Profile \'' + profile.name + '\' authenticated with Google.');

      cb(null);
    });
  };

  //---------------------------------------------------------------------------

  self.newConfig = function(cb) {
    _config = {};

    utils.get_input('Enter the Google Auth Client ID here: ', function (client_id) {
      _config.client_id = client_id;

      utils.get_input('Enter the Google Auth Client Secret here: ', function (client_secret) {
        _config.client_secret = client_secret;

        self.auth = new googleapis.OAuth2Client(_config.client_id, _config.client_secret, AUTH_REDIRECT_URL);

        // generate consent page url
        var url = self.auth.generateAuthUrl({
          access_type: 'offline', // request a refresh token
          scope: 'https://www.googleapis.com/auth/drive.readonly'
        });
        console.log('Please visit the following url: ', url);
        utils.get_input('Enter the authorization code here: ', function (code) {
          // request access token
          self.auth.getToken(code, function (err, credentials) {
            if (err) { return cb(err); }

            _config.credentials = credentials;
            self.auth.setCredentials(_config.credentials);
            utils.logWithTimestamp('Profile \'' + profile.name + '\' authenticated with Google.');

            profile.setConfigSection(CONFIG_SECTION, _config, function (err) {
              if (err) { return cb(err); }

              cb(null);
            });
          });
        });
      });
    });
  };
}

//---------------------------------------------------------------------------

module.exports = GoogleAuth;
