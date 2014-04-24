var utils = require('./lib/utils.js');
var fs = require('fs');
var path = require('path');

var Profile = require('./lib/profile.js');
var GoogleAuth = require('./lib/google_auth.js');
var GoogleDrive = require('./lib/google_drive.js');
var GoogleDriveFS = require('./lib/google_drive_fs.js');

var rootProfilePath = path.join(__dirname, ".profiles");

//---------------------------------------------------------------------------

function mount_all_profiles(cb) {
  fs.readdir(rootProfilePath, function (err, files) {
    files.forEach(function (file) {

      mount_profile(file, function(err) {
        if (err) { return cb(err); }

        cb(null);
      });
    });
  });
}

//---------------------------------------------------------------------------

function mount_profile(profileName, cb) {
  var profilePath = path.join(rootProfilePath, profileName);

  var profile = new Profile(profileName, profilePath);
  var googleAuth = new GoogleAuth(profile);
  googleAuth.load(function(err){
    if (err) { return cb(err); }

    var googleDrive = new GoogleDrive(profile, googleAuth);
    googleDrive.load(function(err){
      if (err) { return cb(err); }

      var googleDriveFS = new GoogleDriveFS(profile, googleDrive);
      googleDriveFS.load(cb);
    });
  });
}

//---------------------------------------------------------------------------

function create_new_profile(cb){
  utils.get_input('Enter the NEW profile name here: ', function (profileName) {

    var profilePath = path.join(rootProfilePath, profileName);

    var profile = new Profile(profileName, profilePath);
    var googleAuth = new GoogleAuth(profile);
    var googleDrive = new GoogleDrive(profile, googleAuth);
    var googleDriveFS = new GoogleDriveFS(profile, googleDrive);

    googleAuth.newConfig(function(err) {
      if (err) { return cb(err); }

      googleDriveFS.newConfig(function(err) {
        if (err) { return cb(err); }

        utils.logWithTimestamp('Profile \'' + profile.name + '\' created successfully.');
        cb(null);
      });
    });
  });
}

//---------------------------------------------------------------------------

function print_usage() {
  console.log();
  console.log("Usage: node app.js [options]");
  console.log();
  console.log("Options:");
  console.log("  -a               : mount all profiles.");
  console.log("  -n               : create new profile.");
  console.log();
  console.log("Examples:");
  console.log("  node app.fs -a");
  console.log("  node app.fs -n");
  console.log();
}

//---------------------------------------------------------------------------

(function main() {
  utils.mkdir(rootProfilePath, function(err) {
    if (err) { return console.error(err); }

    var args = process.argv;
    if (args.length == 2){
      print_usage();
    } else {
      if (args.indexOf('-n') >= 0) {
        create_new_profile(function(err){
          if (err) { return console.error(err); }

          if (args.indexOf('-a') >= 0) {
            mount_all_profiles(function (err) {
              if (err) { return console.error(err); }
            });
          }
        });
      } else if (args.indexOf('-a') >= 0) {
        mount_all_profiles(function(err) {
          if (err) { return console.error(err); }
        });
      } else {
        print_usage();
      }
    }
  });
})();
