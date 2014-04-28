var utils = require('./lib/utils.js');
var fs = require('fs');
var path = require('path');

var Profile = require('./lib/profile.js');
var GoogleAuth = require('./lib/google_auth.js');
var GoogleDrive = require('./lib/google_drive.js');
var GoogleDriveFS = require('./lib/google_drive_fs.js');

var rootProfilePath = path.join(__dirname, ".profiles");

//---------------------------------------------------------------------------

function mount_profile(profileName, mountpoint, cb) {
  utils.mkdir(rootProfilePath, function(err) {
    if (err) { return cb(err); }

    var profilePath = path.join(rootProfilePath, profileName);
    var profile = new Profile(profileName, profilePath);

    var googleAuth = new GoogleAuth(profile);
    googleAuth.load(function(err){
      if (err) { return cb(err); }

      var googleDrive = new GoogleDrive(profile, googleAuth);
      googleDrive.load(function(err){
        if (err) { return cb(err); }

        var googleDriveFS = new GoogleDriveFS(profile, googleDrive, mountpoint);
        googleDriveFS.load(cb);
      });
    });
  });
}

//---------------------------------------------------------------------------
/*
process.on('SIGINT', function() {
  console.log('Process ending.');
  process.exit();
});
*/
//---------------------------------------------------------------------------

function print_usage() {
  console.log();
  console.log("Usage: nodejs app.js profile mountpoint");
  console.log();
  console.log("Example:");
  console.log("  nodejs app.js my-gdrive /mnt/my-gdrive");
  console.log();
}

//---------------------------------------------------------------------------

(function main() {
  //console.log(process.argv);
  //process.exit();

  var args = process.argv;
  if (args.length !== 4) {
    print_usage();
  } else {
    var profile = args[2];
    var mountpoint = args[3];

    mount_profile(profile, mountpoint, function(err) {
      if (err) { return console.error(err); }
    });
  }
})();
