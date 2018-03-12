#!/usr/bin/env node
var path = require('path');
var http = require('http');

const githubUser = '*',
	githubPass='*';

const jenkins = (function(){
	const 
		jenkinsUrl = '*',
		jenkinsPort = 0,
		m2releaseVesrion = 'releaseVersion',
		m2devVesrion = 'developmentVersion',
		m2value = 'value="';

	const jobName = path.win32.basename(path.resolve('./'));
	// const jobName = 'org.visit.web.widget.embed';

	var options = function(){
		return{
			host: jenkinsUrl,
			port: jenkinsPort,
			method: 'GET'
		};
	};

	return {
		getConfig: function(){
			return new Promise((resolve, reject)=>{
				let getOptions = options();
				getOptions.path = '/job/'+jobName+'/config.xml';
				http.get(getOptions, res => {
					res.setEncoding('utf8');
					let body = '';
					res.on('data', data => {
						body += data;
					});
					res.on('end', () => {
						resolve(body);
						// body = JSON.parse(body);
					});
				}).on('error', (e) => {
					reject(e.message);
					// body = JSON.parse(body);
				});
			});
		},
		getNextVersion: function(){
			return new Promise((resolve, reject)=>{
				let getOptions = options();
				getOptions.path = '/job/'+jobName+'/m2release/';
				http.get(getOptions, res => {
					res.setEncoding('utf8');
					let body = '';
					res.on('data', data => {
						body += data;
					});
					res.on('end', () => {
						let nextVersions = {};
						let start = body.indexOf(m2value, body.indexOf(m2releaseVesrion)) + m2value.length;
						let end = body.indexOf('"', start);
						nextVersions.release = body.substring(start, end);
						start = body.indexOf(m2value, body.indexOf(m2devVesrion)) + m2value.length;
						end = body.indexOf('"', start);
						nextVersions.dev = body.substring(start, end);
						resolve(nextVersions);

						// body = JSON.parse(body);
					});
				}).on('error', (e) => {
					reject(e.message);
				});
			});
		},
		build: function(){
			return new Promise((resolve, reject)=>{
				let postOptions = options();
				postOptions.path = '/job/'+jobName+'/build?token='+jobName;
				postOptions.method = 'POST';
				const req = http.request(postOptions, res => {
					let body = '';
					res.on('data', data => {
						body += data;
					});
					res.on('end', () => {
						if(res.statusCode >= 200 && res.statusCode<300)
							resolve(body);
						else
							reject(res.statusMessage);
					});
				}).on('error', (e) => {
					reject(e.message);
				});
				req.end();
			});
		},
		release: function(releaseVersion, devVersion){
			return new Promise((resolve, reject)=>{
				let postOptions = options();
				postOptions.path = '/job/'+jobName+'/m2release/submit';
				postOptions.method = 'POST';
				postOptions.headers = {
					'Content-Type': 'application/x-www-form-urlencoded'
				};
				let data = '';
				let formData = {
					'releaseVersion': releaseVersion,
					'developmentVersion': devVersion,
					'specifyScmCredentials': 'on',
					'scmUsername': githubUser,
					'scmPassword': githubPass,
					'scmCommentPrefix': '[maven-release-plugin]',
					'appendHudsonUserName': 'on',
					'scmTag': jobName + '-' + releaseVersion,
					'json': '{"releaseVersion": "'+releaseVersion+'", "developmentVersion": "'+devVersion+'", "isDryRun": false, "specifyScmCredentials": {"scmUsername": "'+githubUser+'", "scmPassword": "'+githubPass+'"}}',
					'Submit': 'Schedule Maven Release Build'
				};
				for(var formEntry in formData)
				{
					if(formData.hasOwnProperty(formEntry))
					{
						data += formEntry + '=' + encodeURIComponent(formData[formEntry]) + '&';
					}
				}
				data.slice(0, -1);

				const req = http.request(postOptions, res => {
					let body = '';
					res.on('data', data => {
						body += data;
					});
					res.on('end', () => {
						if(res.statusCode == 200)
							resolve(body);
						else
							reject(res.statusMessage);
					});
				}).on('error', (e) => {
					reject(e.message);
				});
				req.write(data);
				req.end();
			});
		},
		console: function(){
			let postOptions = options();
			postOptions.path = 'job/'+jobName+'/'+buildNumber+'/logText/progressiveText';
			/*
			 * 
			 * 
			 * Response: 
			 * X-More-Data:true
			 * X-Text-Size:11268
			 * 
			 * Request:
			 * Content-type:application/x-www-form-urlencoded; charset=UTF-8
			 * Data:
			 * start=11268
			 * 
			 * 
			 */
		},
		stop: function(){
			let postOptions = options();
			postOptions.path = 'job/'+jobName+'/'+buildNumber+'/stop';
		}
	};
})();
// console.log(process.argv);
switch (process.argv[2])
{
case 'build':
	jenkins.build().then(r=>console.log(r)).catch(e=>console.warn(e));
	break;
case 'release':
	if(process.argv[3] && process.argv[4])
		jenkins.release(process.argv[3], process.argv[4]).then(r=>console.log(r)).catch(e=>console.warn(e));
	else
		jenkins.getNextVersion().then(r=>{
			console.log(r);
			return jenkins.release(r.release, r.dev);
		}).then(r=>console.log(r)).catch(e=>console.warn(e));
	break;
case 'status':
	jenkins.getNextVersion().then(r=>console.log(r)).catch(e=>console.warn(e));
	break;
default:
	console.log('Not implemented');
}
