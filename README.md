# gulp-rev-collector-custom

A custom gulp script based on [gulp-rev-collector](https://www.npmjs.com/package/gulp-rev-collector).
Aiming at front-end page processing for java web applications with views including jsp/html. Replace all references of static resources with hashed file names.

#### Usage
1. Indenpendent of web project building. Directly copy `webapp/` folder to current project root directory.
2. Rename target static resources (css/js/image/...) with md5 suffix/splice/... using `gulp-rev`.
3. Search and replace all references in original jsp/html files based on the manifest recording file.

- gulpfile.js
	```javascript
	var gulp = require('gulp');
	var rev = require('gulp-rev');
	var merge = require('merge-stream');
	var revCollectorCustom = require('gulp-rev-collector-custom');
	
	gulp.task('css', function(){
	    return gulp.src('webapp/**/*.css')
	        .pipe(rev())
	        .pipe(gulp.dest('dist/webapp'))
	        .pipe(rev.manifest())
	        .pipe(gulp.dest('dist/rev/css'));
	});
	
	gulp.task('rev',function(){
	    var html = gulp.src(['dist/rev/**/*.json','webapp/**/*.html'])
	        .pipe(revCollectorCustom({
	            replaceReved: true,
	            baseDir: 'webapp/'
	        }))
	        .pipe(gulp.dest('dist/webapp/'));
	
	    var jsp = gulp.src(['dist/rev/**/*.json','webapp/**/*.jsp'])
	        .pipe(revCollectorCustom({
	            replaceReved: true,
	            baseDir: 'webapp/'
	        }))
	        .pipe(gulp.dest('dist/webapp/'));
	
		return merge(jsp, rest);
	}
	```


#### Modification
Compare to `gulp-rev-collector`, add extra process before replace all matched context in manifest json file.
1. Search all static resources link address using 3 ways like
	```
	href="static/css/common/common.css"
	src="static/js/util.js"
	url("static/image/favicon.ico")
	```
2. Optimize urls whose directory path contains `../` and turned to normal path, if the located file really exists.
	eg: Change
	```
	href="../css/common/common.css"
	``` 
	to
	```
	href="/static/css/common/common.css"
	```
