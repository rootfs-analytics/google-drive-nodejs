var fs = require('fs');
var readline = require('readline');

//---------------------------------------------------------------------------

Date.prototype.format = function(format) { //author: meizz
  var o = {
    "M+" : this.getMonth()+1, //month
    "d+" : this.getDate(),    //day
    "h+" : this.getHours(),   //hour
    "m+" : this.getMinutes(), //minute
    "s+" : this.getSeconds(), //second
    "q+" : Math.floor((this.getMonth()+3)/3),  //quarter
    "S" : this.getMilliseconds() //millisecond
  };

  if(/(y+)/.test(format)) format=format.replace(RegExp.$1,
    (this.getFullYear()+"").substr(4 - RegExp.$1.length));
  for(var k in o)if(new RegExp("("+ k +")").test(format))
    format = format.replace(RegExp.$1,
        RegExp.$1.length==1 ? o[k] :
        ("00"+ o[k]).substr((""+ o[k]).length));
  return format;
};

//---------------------------------------------------------------------------

Date.prototype.addMinutes = function(minutes) {
  var date = this;
  return new Date(date.getTime() + (minutes * 60 * 1000));
};

//---------------------------------------------------------------------------

Number.prototype.bytesToSize = function() {
  var bytes = this;
  var k = 1024;
  var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  var i = parseInt(Math.floor(Math.log(bytes) / Math.log(k)),10);
  return (bytes / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
};

//---------------------------------------------------------------------------

module.exports.logWithTimestamp = function() {
  if (arguments.length)
  {
    var timestamp = new Date().format("yyyy-MM-dd h:mm:ss");
    var args = arguments;
    args[0] = timestamp + ' > ' + arguments[0];
    console.log.apply(this, args);
  }
};

//---------------------------------------------------------------------------

module.exports.mkdir = function(path, cb) {
  fs.mkdir(path, function(err) {
    if (err && err.code === 'EEXIST') { return cb(null); }
    cb(err);
  });
};

//---------------------------------------------------------------------------

module.exports.get_input = function(question, cb) {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question(question, function(data){
    rl.close();
    cb(data);
  });
};
