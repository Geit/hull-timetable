var kue = require('kue'),
	jobs = kue.createQueue();
	
	kue.app.listen(27046);
var mysqlConnection = require('./db.js');

kue.Job.rangeByType ('sync', 'complete', 0, 1000, 'asc', function (err, selectedJobs) {
	selectedJobs.forEach(function (job) {
		job.remove();
	});
});
	

fetchTimetableUpdates = function() {
	var startDate =  moment().startOf('isoWeek');
	var endDate = moment().add(4, 'weeks').startOf('isoWeek');
	
	mysqlConnection.query('SELECT * FROM users WHERE last_fetch > 0 AND last_fetch < ? LIMIT 30', [(new moment()).subtract(8, 'hours').unix()], function(err, results) {
		for(var i = 0; i < results.length; i++) {
			console.log('Short sync for ' + results[i].name);
			jobs.create('sync', {
				title: 'Short sync for ' + results[i].name,
				startDate: moment().startOf('isoWeek'), 
				endDate:  moment().startOf('isoWeek').add(4, 'weeks'), 
				userId: results[i].id
			}).removeOnComplete(true).save( function(err){
			   if(err) console.log(err);
			});
		}
	});
};
 
setInterval(fetchTimetableUpdates, 5*60*1000);
fetchTimetableUpdates();

var processSyncJob = function(job, done) {
	var totalWeeks = (moment(job.data.endDate).startOf('isoWeek')).diff(moment(job.data.startDate).startOf('isoWeek'), 'weeks');
	var cookieJar = http_req.jar();
	var userData;
	job.log('Sync job started - %d weeks of timetabling to process', totalWeeks);
	function fetchUserDetails() {
		mysqlConnection.query('SELECT * FROM users WHERE id = ?', [job.data.userId], function(err, results) {
			if(results.length == 0) {
				job.log('User does not exist');
				done();
			}
			userData = results[0];
			cookieJar.setCookie(http_req.cookie(atob(userData.cookie)), 'https://hull.ombiel.co.uk/campusm');
			cookieJar.setCookie(http_req.cookie(atob(userData.secret)), 'https://hull.ombiel.co.uk/campusm');
			job.log('User data fetched.');
			next(0);
		});
	}
	 
	function next(weekNum) {
		var dateToFetch = moment(job.data.startDate).add(weekNum, 'weeks').startOf('isoWeek');
		
		job.log("Fetching timetable for %s for the week of %s (%d/%d)", userData.name, dateToFetch.format('Do MMM, YYYY'), weekNum+1, totalWeeks);
			
		http_req({url: 'https://hull.ombiel.co.uk/campusm/calendar/course_timetable/' + dateToFetch.format('YYYYDDDD'), jar: cookieJar}, function(err, httpResponse, body){
			var responseData;
			try {
				responseData = JSON.parse(body);
			} catch(e) {
				responseData = body;
			}

			if(typeof responseData.events != "undefined") {
				if(responseData.events.length != 0)	{
					var  uids = [];
					var events = []
					for (var i = 0; i < responseData.events.length; i++) {
						events.push([
							responseData.events[i].id, // uid
							responseData.events[i].desc1, // title
							(new moment(responseData.events[i].start)).unix(), // start
							(new moment(responseData.events[i].end)).unix(),// end
							(responseData.events[i].teacherName || 'N/A').replace(/;/g, ', '), // teachers
							responseData.events[i].locAdd1 || responseData.events[i].locCode || 'N/A' // location
						]);
						uids.push(responseData.events[i].id);
					}
					
					mysqlConnection.query('INSERT INTO events (uid, title, start, end, teachers, location) VALUES ? ON DUPLICATE KEY UPDATE start=VALUES(start), end=VALUES(end), teachers=VALUES(teachers), location=VALUES(location)', [events], function(err, results) {
						if(err)
							throw err;
							
						mysqlConnection.query('DELETE user_events FROM user_events LEFT JOIN events ON events.id=event_id WHERE user_id = ? AND events.start < ? AND events.start > ?', [job.data.userId, dateToFetch.unix()+(7*24*60*60), dateToFetch.unix()]);
						mysqlConnection.query('INSERT IGNORE INTO user_events (user_id, event_id) SELECT ?, id FROM events WHERE uid IN (?)', [job.data.userId, uids]);
					});
				}
				if(weekNum < totalWeeks-1) {
					next(weekNum + 1);
					job.progress(weekNum + 1, totalWeeks);
				} else {
					mysqlConnection.query('UPDATE users SET last_fetch=UNIX_TIMESTAMP() WHERE id=?', [job.data.userId]);
					done();
				}
			}
			else
				console.log(responseData);
		});
	}
	fetchUserDetails();
}

jobs.process('sync', processSyncJob);