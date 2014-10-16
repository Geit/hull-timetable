var express = require('express');
	router = express.Router(),
	http_req = require('request'),
	btoa = require('btoa'),
	atob = require('atob'),
	moment = require('moment-timezone'),
	kue = require('kue'),
	jobs = kue.createQueue(),
	settings = require('./settings.json');
	
var mysqlConnection = require('./db.js');

/* GET home page. */
router.get('/', function(req, res) {
	res.render('index', { error: req.param('error')});
});

router.post('/auth', function(req, res) {
	var username = req.param('username'),
		password = req.param('password');
	
	if (typeof username == "undefined" || typeof password == "undefined")
		return res.redirect('/timetables/?error=Invalid User or Password'); // Request failed.
	
	username = username.trim().replace("@hull.ac.uk", "");
	
	// Check if the user already exists and redirect prematurely if so.
	mysqlConnection.query('SELECT * FROM users WHERE id = ?', [username], function(err, results) {
		if(err)
			throw err;
		if(results.length > 0)
			return res.redirect('/timetables/my_timetable/' + username);
		// Continue as normal
		var cookieJar = http_req.jar();
		
		http_req({url: 'https://hull.ombiel.co.uk/campusm/home', jar: cookieJar}, function(err, httpResponse, body){
			http_req.post('https://hull.ombiel.co.uk/campusm/ldap/282', {form:{username: username, password: password}, jar: cookieJar}, function(err, httpResponse, body){
				//Check user validated correctly.
				var userData;
				try {
					userData = JSON.parse(body);
					if(typeof userData.firstname == "undefined")
						throw "Authentication Failed";
				} catch(e) {
					return res.redirect('/timetables/?error=iHull rejected the User/Password');
				}
				
				http_req.post('https://hull.ombiel.co.uk/campusm/setupuser/282/320', {form: '{"userRoles":false,"orgCode":262}', jar: cookieJar}, function(err, httpResponse, body){
					//Extract firstname and lastname from user data and save data to mysql.
					var queryData = [
						userData.serviceUsername_253, 
						userData.firstname + ' ' + userData.surname, 
						btoa(cookieJar._jar.store.idx['hull.ombiel.co.uk']['/']['__a']), 
						btoa(cookieJar._jar.store.idx['hull.ombiel.co.uk']['/']['a']),
						btoa(cookieJar._jar.store.idx['hull.ombiel.co.uk']['/']['__a']), 
						btoa(cookieJar._jar.store.idx['hull.ombiel.co.uk']['/']['a'])
					];
					mysqlConnection.query('INSERT IGNORE INTO users SET id=?, name=?, secret=?, cookie=? ON DUPLICATE KEY UPDATE secret=?, cookie=?', queryData, function(err, results){
						if(err)
							throw err;
						
						jobs.create('sync', {
							title: 'First sync for ' + userData.firstname + ' ' + userData.surname,
							startDate: settings.sync_start_date,
							endDate:  settings.sync_end_date,
							userId: userData.serviceUsername_253
						}).priority('high').save( function(err){
						   if(err) console.log(err);
						});
						res.redirect('/timetables/my_timetable/' + username);
					});
				});
			});
		});
	});	
});

router.get('/:username.ics', function(req, res) {
	var username = req.param('username');
	mysqlConnection.query('SELECT * FROM users WHERE id = ?', [username], function(err, userData) {
		if(userData.length == 0)
			return res.redirect('/timetables/');
		userData = userData[0];
		
		mysqlConnection.query('SELECT events.* FROM events LEFT JOIN user_events ON event_id=events.id WHERE user_id=?', [username], function(err, events) {
			for(var i = 0; i < events.length; i++) {
				events[i].start = (moment.unix(events[i].start)).tz("Europe/London").format('YYYYMMDD[T]HHmmss');
				events[i].end = (moment.unix(events[i].end)).tz("Europe/London").format('YYYYMMDD[T]HHmmss');
			}
			
			res.type('text/calendar');
			res.attachment(userData.name + '\'s Calendar.ics');
			res.render('calendar', {events: events, user: userData});
			
			mysqlConnection.query('UPDATE users SET last_used=UNIX_TIMESTAMP() WHERE id=?', [username]);
		});
	});
});

router.get('/my_timetable/:username', function(req, res) {
	var username = req.param('username');
	
	mysqlConnection.query('SELECT * FROM users WHERE id = ?', [username], function(err, userData) {
		if(userData.length == 0)
			return res.redirect('/timetables/?error=' + 'Login first');
		
		userData = userData[0];
		if(userData.last_fetch == 0) {
			kue.Job.rangeByType ('sync', 'active', 0, 100, 'asc', function (err, selectedJobs) {
				selectedJobs.forEach(function (job) {
					if(job.data.userId == username)
						return res.render('prepare_calendar', {
							user: userData,
							percentageComplete: job._progress || 0
						});
				});
				return res.render('prepare_calendar', {user: userData});
			});
			
		} else
			return res.render('calendar_ready', {user: userData});
		
	});
});

module.exports = router;
