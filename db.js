var mysql = require('mysql');
var settings = require('./settings.json');

var mysqlConnection;

var connectToDB = function(){
	mysqlConnection = mysql.createConnection({
		host: settings.db_host,
		user: settings.db_user,
		password: settings.db_password,
		database: settings.db_database
	});
	mysqlConnection.connect();

	mysqlConnection.on('error', function(err) {
		if(err.code == 'PROTOCOL_CONNECTION_LOST')
			connectToDB();
		else
			throw err;
	});
};
connectToDB();

module.exports = mysqlConnection;