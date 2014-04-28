var utils = require('./utils.js');
var path = require('path');
var winston = require('winston');

var memwatch = require('memwatch');

function HealthLogger(rootLogsPath) {
  var self = this;

  var _healthLogger = new (winston.Logger)({
    exitOnError: false,
    transports: [
      new (winston.transports.File)({
        filename: 'health.log',
        dirname: rootLogsPath,
        maxSize: 1024 * 1024,
        maxFiles: 10,
        json: false,
        timestamp: function () { return new Date().format("yyyy-MM-dd h:mm:ss"); }
      })
    ]
  });

  //var heapDiff;

  //---------------------------------------------------------------------------

  self.start = function() {
    _healthLogger.info('Started');

    setInterval(print_mem_usage, 60 * 1000);

    memwatch.on('stats', function (stats) {
      print_gc_stats(stats);
      print_mem_usage();

      /*
       if (heapDiff) {
       var diff = heapDiff.end();
       console.log('memwatch.heapdiff', JSON.stringify(diff, null, '  '));
       }
       heapDiff = new memwatch.HeapDiff();
       */
    });
  };

  //---------------------------------------------------------------------------

  function print_mem_usage() {
    var memUsage = process.memoryUsage();
    memUsage.rss = memUsage.rss.bytesToSize();
    memUsage.heapTotal = memUsage.heapTotal.bytesToSize();
    memUsage.heapUsed = memUsage.heapUsed.bytesToSize();

    _healthLogger.info('process.memoryUsage >', memUsage);
  }

  //---------------------------------------------------------------------------

  function print_gc_stats(stats) {
    var myStats = {
      fullGc: stats.num_full_gc,
      incGc: stats.num_inc_gc,
      heapCompacts: stats.heap_compactions,
      base: stats.current_base.bytesToSize()
    };

    _healthLogger.info('memwatch.stats >', myStats);
  }
}
//---------------------------------------------------------------------------

module.exports = HealthLogger;
