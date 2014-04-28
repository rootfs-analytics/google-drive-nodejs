var utils = require('./lib/utils.js');
var fs = require('fs');
var path = require('path');
var winston = require('winston');

var Profile = require('./lib/profile.js');
var GoogleAuth = require('./lib/google_auth.js');
var GoogleDrive = require('./lib/google_drive.js');
var GoogleDriveFS = require('./lib/google_drive_fs.js');

var rootProfilePath = path.join(__dirname, ".profiles");
var rootLogsPath = path.join(__dirname, ".logs");

//---------------------------------------------------------------------------

var healthLogger = new(winston.Logger)({
  exitOnError: false,
  transports: [
    new(winston.transports.DailyRotateFile)({
      filename: 'health.log',
      dirname: rootLogsPath,
      datePattern: 'HH',
      maxFiles: 24,
      json: false,
      timestamp: function () { return new Date().format("yyyy-MM-dd h:mm:ss"); }
    })
  ]
});

healthLogger.info('Process Started');

function print_mem_usage() {
  var memUsage = process.memoryUsage();
  memUsage.rss = memUsage.rss.bytesToSize();
  memUsage.heapTotal = memUsage.heapTotal.bytesToSize();
  memUsage.heapUsed = memUsage.heapUsed.bytesToSize();

  //console.log('process.memoryUsage =', memUsage);
  healthLogger.info('process.memoryUsage >', memUsage);
}
setInterval(print_mem_usage, 60 * 1000);

var memwatch = require('memwatch');
//var heapDiff;

memwatch.on('stats', function(stats) {
  var myStats = {
    fullGc: stats.num_full_gc,
    incGc: stats.num_inc_gc,
    heapCompacts: stats.heap_compactions,
    base: stats.current_base.bytesToSize()
  };

  //console.log('memwatch.stats =', myStats);
  healthLogger.info('memwatch.stats >', myStats);
  print_mem_usage();

  /*
   if (heapDiff) {
   var diff = heapDiff.end();
   console.log('memwatch.heapdiff', JSON.stringify(diff, null, '  '));
   }
   heapDiff = new memwatch.HeapDiff();
   */
});


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

process.on('SIGINT', function() {
  console.log('Process ending.');
  process.exit();
});

//---------------------------------------------------------------------------

(function main() {
  utils.mkdir(rootProfilePath, function(err) {
    if (err) { return console.error(err); }

    utils.mkdir(rootLogsPath, function(err) {
    if (err) { return console.error(err); }

      var args = process.argv;
      if (args.length == 2) {
        print_usage();
      } else {
        if (args.indexOf('-n') >= 0) {
          create_new_profile(function(err) {
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
  });
})();
