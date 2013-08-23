module.exports = function (argv) {
    /*!
     * bandwidth-limiter-http-proxy
     * Copyright (c) 2012 <commenthol@prrtr.de>  2013 <demohi.github.com>
     * MIT Licensed
     */
    var
        http = require('http'),
        net = require('net'),
        url = require('url'),
        config = require('./config')(argv);
    if (!config) {
        return;
    }
    /*
     * settings
     */
    var
        port = config.port,				// port under which proxy is available
        bandwidth_down = config.bandwidth_down,	// in bps
        bandwidth_up = config.bandwidth_up,	// in bps
        latency = config.latency;		// in ms

    var time_logs = [];
    time_logs['重定向时间'] = [];
    time_logs['DNS解析时间']= [];
    time_logs['TCP连接时间']= [];
    time_logs['请求响应耗时']= [];
    time_logs['页面下载时间']= [];
    time_logs['DomReady时间']= [];
    time_logs['渲染耗时']= [];
    time_logs['DomReadyEvent耗时']= [];
    time_logs['Load时间']= [];
    time_logs['LoadEvent耗时']= [];

    var settingspage = '<!doctype html><html><head><meta charset="utf-8" /><title>Proxy Settings</title><style type="text/css"> *{margin:0px;padding:3px;font-family:Sans-Serif}body{margin:0px auto;max-width:320px}ul{list-style:none}li{clear:both}section{margin:7px;border:1px solid #ccc}.r{float:right}</style></head><body><h1>Proxy Settings</h1><section><h2>Current</h2><ul><li>Bandwidth Download: <span class="r">#bandwidth_down# bps</span></li><li>Bandwidth Upload: <span class="r">#bandwidth_up# bps</span></li><li>Latency: <span class="r">#latency# ms</span></li></ul></section><section><h2>Profile</h2><ul><li><a href="/?dn=64000&up=32000&la=200">GPRS</a></li><li><a href="/?dn=128000&up=64000&la=200">EDGE</a></li><li><a href="/?dn=256000&up=96000&la=90">UMTS</a></li><li><a href="/?dn=1200000&up=256000&la=60">HSDPA</a></li><li><a href="/?dn=1200000&up=1200000&la=25">LTE 4G</a></li><li><a href="/?dn=33600&up=33600&la=100">V.34 33kbps modem</a></li><li><a href="/?dn=56000&up=48000&la=100">V.92 56kbps modem</a></li><li><a href="/?dn=64000&up=64000&la=25">ISDN</a></li><li><a href="/?dn=128000&up=128000&la=25">ISDN (2 channels)</a></li><li><a href="/?dn=384000&up=64000&la=25">DSL light</a></li><li><a href="/?dn=900000&up=256000&la=25">ADSL</a></li></ul></section><section><h2>Custom</h2><form method="get" action="/"><ul><li><label for="dn">Bandwidth Download (&gt;1000 bps)</label><br/><input name="dn" value="#bandwidth_down#"/></li><li><label for="up">Bandwidth Upload (&gt;1000 bps)</label><br/><input name="up" value="#bandwidth_up#"/></li><li><label for="la">Latency (&lt;1000 ms)</label><br/><input name="la" value="#latency#"/></li><li><input type="submit"/></li></ul></form></section></body></html>';

    /**
     * simple logger
     */
    var log = {
        level: 'info',
        conv: function (str, depth) {
            var s = '';
            depth = depth || 0;
            switch (typeof(str)) {
                case 'number':
                    return str;
                case 'string':
                    return "'" + str + "'";
                case 'object':
                    if (depth > 3) {
                        return "'[Object]'";
                    }
                    s += "{";
                    for (var i in str) {
                        //s += "\n";
                        s += " '" + i + "': " + this.conv(str[i], depth + 1);
                        if (s[s.length - 1] !== ',') {
                            s += ',';
                        }
                    }
                    if (s[s.length - 1] === ',') {
                        s = s.substring(0, s.length - 1);
                    }
                    s += " },";
                    return s;
                default:
                    return;
            }
        },
        log: function (str) {
            console.log(this.conv(str));
        },
        debug: function (str) {
            if (this.level === 'debug') {
                this.log({time: Date.now(), debug: str});
            }
        },
        info: function (str) {
            if (this.level === 'debug' ||
                this.level === 'info') {
                this.log({time: Date.now(), info: str});
            }
        },
        warn: function (str) {
            if (this.level === 'debug' ||
                this.level === 'info' ||
                this.level === 'warn') {
                this.log({time: Date.now(), warn: str});
            }
        },
        error: function (str) {
            this.log({time: Date.now(), error: str});
        }
    };

    /**
     * calculate the delay based on bandwith
     *
     * @param length {number}, length of chunk
     * @param bandwidth {number}, bandwidth in bit per second
     * @returns {number}, delay in milliseconds required to transfer the
     *   `length` bytes over a network with a given `bandwidth`.
     */
    function calcDelay(length, bandwidth) {
        return parseInt(0.5 + length * 8 * 1000 / bandwidth, 10);
    }

    /**
     * calculate the length of the http header
     *
     * @param headers {object}, contains http headers
     * @returns {number}, length in bytes used for the headers
     */
    function calcHeaderLength(headers) {
        var
            reslen = 15;	// approx "HTTP/1.1 200 OK"

        if (headers) {
            for (var i in headers) {
                reslen += i.length + headers[i].length + 4; // 4 ": " + "\r\n"
            }
        }
        return reslen;
    }

    function calcTime_baidu(time_log) {
        var temp_array = time_log.split("&").slice(1);
        for (var temp in temp_array) {
            var log_key = temp_array[temp].split("=")[0];
            var log_value = temp_array[temp].split("=")[1];
            if (log_key != "browser" && log_key != "phoneid" && log_key != "logid" && log_key != "ta_net"
                && log_key != "taspeed" && log_key != "ls" && log_key != 'later' && log_key != "net" && log_key != "ortn" && log_key != "adflag" && log_key != "pagetype") {
                if (!time_logs[log_key]) {
                    time_logs[log_key] = [];
                }
                time_logs[log_key].push(parseInt(log_value));
            }
        }
    }

    function calcTime_timing(time_log) {
        var temp_array = time_log.split("?")[1].split("&");
        var timing_array = [];
        for (var temp in temp_array) {
            var log_key = temp_array[temp].split("=")[0];
            var log_value = temp_array[temp].split("=")[1];
            timing_array[log_key] = log_value;
        }

        time_logs['重定向时间'].push(timing_array['redirectEnd'] - timing_array['redirectStart']);
        time_logs['DNS解析时间'].push(timing_array['domainLookupEnd'] - timing_array['domainLookupStart']);
        time_logs['TCP连接时间'].push(timing_array['connectEnd'] - timing_array['connectStart']);
        time_logs['请求响应耗时'].push(timing_array['responseStart'] - timing_array['requestStart']);
        time_logs['页面下载时间'].push(timing_array['responseEnd'] - timing_array['responseStart']);
        time_logs['DomReady时间'].push(timing_array['domContentLoadedEventStart'] - timing_array['navigationStart']);
        time_logs['渲染耗时'].push(timing_array['domInteractive'] - timing_array['domLoading']);
        time_logs['DomReadyEvent耗时'].push(timing_array['domContentLoadedEventEnd'] - timing_array['domContentLoadedEventStart']);
        time_logs['Load时间'].push(timing_array['loadEventStart'] - timing_array['navigationStart']);
        time_logs['LoadEvent耗时'].push(timing_array['loadEventEnd'] - timing_array['loadEventStart']);
    }

    function calcThreshold(log_key) {
        var threshold = 0;
        if (config.latency < 500) {
            if (log_key == 'load') {
                threshold = 2500;
            }
            else if (log_key == 'firstSc') {
                threshold = 1400;
            }
            else if (log_key.indexOf('-1') != -1) {
                threshold = 300;
            }
            else if (log_key.indexOf('-') != -1) {
                threshold = 200;
            }
        }
        else {
            if (log_key == 'load') {
                threshold = 2000;
            }
            else if (log_key == 'firstSc') {
                threshold = 600;
            }
            else if (log_key.indexOf('-1') != -1) {
                threshold = 200;
            }
            else if (log_key.indexOf('-') != -1) {
                threshold = 200;
            }
        }
        return threshold;
    }
    function calcLevel(log_key){
        return log_key=='domc'||log_key=='load'||log_key=='firstSc'||log_key=='psize'||log_key.indexOf('-')!=-1;
    }
    var test  = [];
    test['a'] = [1,2,3];
    function showResult() {
        var time_css = '<style>body{font-family:"Microsoft YaHei",Verdana,Arial,Helvetica,sans-serif;font-size:12px;color:#4f6b72;background:#E6EAE9}#mytable{padding:0;margin:0}th{color:#4f6b72;border-right:1px solid #C1DAD7;border-bottom:1px solid #C1DAD7;border-top:1px solid #C1DAD7;letter-spacing:2px;text-align:left;padding:6px 6px 6px 12px;background:#CAE8EA no-repeat;font-size:12px}td{border-right:1px solid #C1DAD7;border-bottom:1px solid #C1DAD7;background:#fff;padding:6px 6px 6px 12px;color:#4f6b72;font-size:12px}</style>';
        var time_show = time_css + '<table id="mytable"><thead><tr><th>ID</th><th>最小值</th><th>最大值</th><th>平均值</th><th>中位数</th><th>准入值</th><th>测试次数</th><th>测试结果</th></tr></thead><tbody>';
        for (var log_key in time_logs) {
            if(!calcLevel(log_key)){
                continue;
            }
            var temp_sort = time_logs[log_key].sort(function (a, b) {
                return a > b ? 1 : -1
            });
            var median = 0;
            var average = 0;
            var min = temp_sort[0];
            var max = temp_sort[temp_sort.length - 1];
            if (temp_sort.length % 2 == 0) {
                median = Math.round((temp_sort[temp_sort.length / 2] + temp_sort[(temp_sort.length / 2) - 1]) / 2);
            }
            else {
                median = temp_sort[parseInt(temp_sort.length / 2)];
            }
            average = Math.round(eval(temp_sort.join("+")) / temp_sort.length);
            time_show += '<tr><th>' + log_key + '</th><td>' + min + '</td><td>' + max + '</td><td>' + average + '</td><td>' + median + '</td><td>';
            var threshold = calcThreshold(log_key);

            time_show += threshold + '</td><td>' + temp_sort.length + '</td>';
            if (threshold == 0) {
                time_show += '<td></td></tr>';
            }
            else if (average < threshold) {
                time_show += '<td style="background-color: lime"></td></tr>';
            }
            else {
                time_show += '<td style="background-color: red"></td></tr>'
            }
        }
        time_show += '<tr><th  style="background-color:#358be8"></th><td style="background-color:#358be8"></td><td style="background-color:#358be8"></td><td style="background-color:#358be8"></td><td style="background-color:#358be8"></td><td style="background-color:#358be8">';
        time_show +=  '</td><td style="background-color:#358be8"></td>';
        time_show += '<td style="background-color:#358be8"></td></tr>';
        for (var log_key in time_logs) {
            if(calcLevel(log_key)){
                continue;
            }
            var temp_sort = time_logs[log_key].sort(function (a, b) {
                return a > b ? 1 : -1
            });
            var median = 0;
            var average = 0;
            var min = temp_sort[0];
            var max = temp_sort[temp_sort.length - 1];
            if (temp_sort.length % 2 == 0) {
                median = Math.round((temp_sort[temp_sort.length / 2] + temp_sort[(temp_sort.length / 2) - 1]) / 2);
            }
            else {
                median = temp_sort[parseInt(temp_sort.length / 2)];
            }
            average = Math.round(eval(temp_sort.join("+")) / temp_sort.length);
            time_show += '<tr><th>' + log_key + '</th><td>' + min + '</td><td>' + max + '</td><td>' + average + '</td><td>' + median + '</td><td>';
            var threshold = calcThreshold(log_key);

            time_show += threshold + '</td><td>' + temp_sort.length + '</td>';
            if (threshold == 0) {
                time_show += '<td></td></tr>';
            }
            else if (average < threshold) {
                time_show += '<td style="background-color: lime"></td></tr>';
            }
            else {
                time_show += '<td style="background-color: red"></td></tr>'
            }
        }
        time_show += '</tbody></table>';
        time_logs = [];
        time_logs['重定向时间'] = [];
        time_logs['DNS解析时间']= [];
        time_logs['TCP连接时间']= [];
        time_logs['请求响应耗时']= [];
        time_logs['页面下载时间']= [];
        time_logs['DomReady时间']= [];
        time_logs['渲染耗时']= [];
        time_logs['DomReadyEvent耗时']= [];
        time_logs['Load时间']= [];
        time_logs['LoadEvent耗时']= [];
//        time_logs['Redirect'] = [];
//        time_logs['DNS'] = [];
//        time_logs['TCP'] = [];
//        time_logs['Request'] = [];
//        time_logs['Response'] = [];
//        time_logs['DomReady'] = [];
//        time_logs['Render'] = [];
//        time_logs['DomReadyEvent'] = [];
//        time_logs['Load'] = [];
//        time_logs['LoadEvent'] = [];
        return time_show;
    }

    /**
     * proxy connection to connection2
     * delay the connection by a given latency and bandwidth
     *
     * @param options {object},
     *   bandwidth {number}, bandwidth in bit per second
     *   delay {number}, initial delay in milliseconds (use to add latency)
     *   type {string} optional, used for debugging, defaults to ''
     * @param connection {object}, connection with is proxied
     *   Can be either a http req, res object or a socket
     * @param connection2 {object}, proxied connection
     *   Can be either a http req, res object or a socket
     */
    function proxy(options, connection, connection2) {
        var
            delay = 0,								// single delay of one packet
            quene = [],								// array to store timestamps to measure the jitter
            timeref = 0,							// correct the time jitter between packets
            type = options.type || '',
            bytes = options.bytes || 0,
            next;

        // print out some info on throughput
        function transfer(bytes, timeref) {
            var
                d = 0,
                bw = 0;
            d = Date.now() - timeref;
            if (d !== 0 && bytes > 0) {
                bw = parseInt(bytes * 8 * 1000 / d, 10);
//			log.info({type: type, duration: d, bytes: bytes, bandwidth: bw,
//				url: options.url});
            }
        }

        // process quene
        function procQuene(quene) {
            var
                now = Date.now(),
                jitter,
                qo;

            qo = quene.shift(1) || {};

            if (qo.chunk !== undefined) {
                jitter = parseInt(qo.time - now, 10);
                log.debug({type: type, jitter: jitter, now: now,
                    packetlength: qo.chunk.length});
                connection2.write(qo.chunk, 'binary');
            }
            else {
                log.debug({type: type, msg: 'event end - connection.end'});
                connection2.end();
            }
            if (quene.length === 0) {
                transfer(bytes, timeref);
            }
        }

        // get next timestamp
        function timestamp(quene, delay) {
            var
                timeout,
                next = 0;

            if (quene[quene.length - 1] && quene[quene.length - 1].time) {
                next = quene[quene.length - 1].time;
            }
            next += delay;
            timeout = next - Date.now();
            if (timeout < 0) {
                timeout = delay;
                next = Date.now() + delay;
            }
            return { time: next, timeout: timeout };
        }

        // data received
        connection.on('data', function (chunk) {
            if (timeref === 0) {
                timeref = Date.now();
                delay = options.delay || 0; // consider initial delay
                log.debug({type: type, timeref: timeref});
            } else {
                delay = 0;
            }
            // calc the latency
            delay += calcDelay(chunk.length, options.bandwidth);
            bytes += chunk.length;

            // add timestamp to quene
            next = timestamp(quene, delay);
            quene.push({time: next.time, chunk: chunk});

            log.debug({type: type, data: chunk.length, next: next.time,
                delay: delay});

            setTimeout(function () {
                procQuene(quene);
            }, next.timeout);
        });

        // connection ends
        connection.on('end', function () {
            delay = options.delay || 0;
            if (timeref === 0) {
                timeref = Date.now();
            }
            next = timestamp(quene, delay);
            quene.push({time: next.time});

            setTimeout(function () {
                procQuene(quene);
            }, next.timeout);
        });
    }

    /**
     * the proxy stuff
     */
    var server = http.createServer(/*options,*/);

    server.listen(port);

// http proxy
    server.on('request', function (request, response) {
        var
            options = {},			// options object for the http proxy request
            headers = {},			// headers object for the http proxy request
            _url,							// url parsing
            bytes,
            delay;

        /*
         // this will not work if the request is made to loc++al servers
         // therefore use url parsing and set the request
         options = {
         host: request.headers['host'],
         };
         */
        _url = url.parse(request.url);
        if (request.url.indexOf("domc=") != -1 && request.url.indexOf("load=") != 1) {
            calcTime_baidu(request.url);
        }
        else if (request.url.indexOf("wpotest.com/timing") != -1) {
            calcTime_timing(request.url);
            response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
            response.write('ok', 'utf-8');
            response.end();
        }
        else if (request.url.indexOf("wpotest.com/end") != -1) {
            var time_show = showResult();
            response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
            response.write(time_show, 'utf-8');
            response.end();
        }
        headers = request.headers;
        headers['cache-control'] = 'no-cache';
        headers['pragma'] = 'no-cache';
        headers['if-none-match'] = '';
        headers['if-modified-since'] = '';
        headers && log.debug(headers);

        options = {
            hostname: _url.hostname || "localhost",
            port: _url.port || 80,
            method: request.method,
            path: _url.path || "/",
            headers: headers
        };

        // proxy settings page
        if (request.headers.host === ('localhost:' + port)) {
            if (_url.pathname === '/') {
                var p, q, qq, v, i;

                // change settings
                if (_url.query) {
                    q = _url.query.split('&');
                    for (i in q) {
                        qq = q[i].split('=');
                        if (qq[1]) {
                            v = parseInt(qq[1], 10);
                            if (typeof(v) === 'number') {
                                switch (qq[0]) {
                                    case 'dn':
                                        if (v > 1000) {
                                            bandwidth_down = v;
                                        }
                                        break;
                                    case 'up':
                                        if (v > 1000) {
                                            bandwidth_up = v;
                                        }
                                        break;
                                    case 'la':
                                        if (qq[1] < 1000) {
                                            latency = v;
                                        }
                                        break;
                                }
                            }
                        }
                    }
                    log.info({'new settings': { bandwidth_down: bandwidth_down,
                        bandwidth_up: bandwidth_up, latency: latency } });
                    response.writeHead('302', {'Location': '/'});
                    response.end();
                    return;
                }

                p = settingspage;
                p = p.replace(/#bandwidth_down#/g, bandwidth_down);
                p = p.replace(/#bandwidth_up#/g, bandwidth_up);
                p = p.replace(/#latency#/g, latency);
                response.writeHead('200', {'Content-Type': 'text/html', 'Content-Length': p.length });
                response.end(p);
            }
            else {
                response.end('404');
            }
        }
        else {
            // handle proxy requests
            var proxyRequest = http.request(options, function (proxyResponse) {
                var
                    bytes,
                    delay;

                // calc the http headers length as this influences throughput on low speed networks
                // length of the response header bytes is initial delay
                bytes = calcHeaderLength(proxyResponse.headers);
                delay = calcDelay(bytes, bandwidth_down) + latency;
                response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
                proxy({
                        url: request.url,
                        type: 'http-res',
                        delay: delay,
                        bytes: bytes,
                        bandwidth: bandwidth_down },
                    proxyResponse, response);
            });

            proxyRequest.on('error', function (e) {
                log.error('problem with request: ' + e.message);
                response.writeHead(500, { 'content-type': 'text/html' });
                response.write(e.message, 'utf-8');
                response.end();
            });
            proxyRequest.on('timeout', function (e) {
                log.error('problem with request: ' + e.message);
                response.writeHead(408, { 'content-type': 'text/html' });
                response.write(e.message, 'utf-8');
                response.end();
            });

            // calc the http headers length as this influences throughput on low speed networks
            bytes = calcHeaderLength(request.headers);
            delay = calcDelay(bytes, bandwidth_up) + latency;
            proxy({
                    url: request.url,
                    type: 'http-req',
                    delay: delay,
                    bytes: bytes,
                    bandwidth: bandwidth_up },
                request, proxyRequest);

            log.debug('-------');

        }
    });

// ssl tunneling http proxy
// References
// http://www.w3.org/Protocols/rfc2616/rfc2616-sec9
// http://muffin.doit.org/docs/rfc/tunneling_ssl.html
    server.on('connect', function (request, socket, head) {
        var
            client,						// client socket for SSL
            host,
            options = {};			// options object for client

        if (request.url) {
            host = request.url.match(/^(.*):(\d+$)/);
            if (host.length === 3) {
                options = {
                    host: host[1],
                    port: host[2]
                };
            } else {
                socket.destroy();
                return;
            }
            //log.info({url: request.url, protocol: 'https'});
        }

        // Return SSL-proxy greeting header.
        socket.write('HTTP/' + request.httpVersion + ' 200 Connection established\r\n\r\n');

        // Now forward SSL packets in both directions until done.
        client = net.connect(options,
            function () { //'connect' listener
                log.debug('client connected');
            });

        // handle stream from origin
        proxy({
                url: request.url,
                type: 'https-req',
                delay: latency,
                bandwidth: bandwidth_up },
            socket, client);
        socket.on('error', function () {
            log.debug('socket error');
            client.end();
        });
        socket.on('timeout', function () {
            log.debug('socket timeout');
            client.end();
        });
        socket.on('close', function () {
            log.debug('socket close');
            client.end();
        });

        // handle stream to target
        proxy({
                url: request.url,
                type: 'https-res',
                delay: latency,
                bandwidth: bandwidth_down },
            client, socket);
        client.on('error', function () {
            log.debug('client error');
            socket.end();
        });
        client.on('timeout', function () {
            log.debug('client timeout');
            socket.end();
        });
        client.on('close', function () {
            log.debug('client close');
            socket.end();
        });

    });

    log.info("Proxy runs on port " + port);
    log.info("Download bandwidth is " + bandwidth_down + ' bps');
    log.info("Upload bandwidth is " + bandwidth_up + ' bps');
    log.info("Latency is " + latency + ' ms');

}