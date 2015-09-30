var net  = require('net');
var mail = require('nodemailer');
var os   = require('os');


var nodeData = {};
var isMaster = false;


// configurable
var configuration = {
    vip: {
        command: ['i', 'ip'],
        name: 'ip address that haproxy is listening on',
        required: true,
        value: null
    },
    checkInterval: {
        command: ['c'],
        name: 'check interval in ms',
        value: 2000
    },
    socket: {
        command: ['s'],
        name: 'path to the haproxy socket',
        required: true,
        value: '/etc/haproxy/haproxysock'
    },
    recipient: {
        command: 'r',
        name: 'specify an email address to send notifications to. Use multiple switches for more than one',
        value: []
    }
};

// entry point --
if (!(require('commandlinejs')(configuration)).parseCommandLine())
    return;

console.log(JSON.stringify(configuration.recipient.value));

var transport = mail.createTransport({
    host: 'xpomail1.xpologistics.com'
});

// TODO: pass in the VIP, monitor interval, mail server?, email config

if (!isMasterNode(configuration.vip.value))
    return;

inspectStats();
setInterval(inspectStats, configuration.checkInterval.value);


function isMasterNode(addr)
{
    var interfaces = os.networkInterfaces();
    //console.log(JSON.stringify(interfaces));
    var keys = Object.keys(interfaces);
    for (var i=0; i < keys.length; i++)
        for (var a=0; a < interfaces[keys[i]].length; a++)
            if (interfaces[keys[i]][a].address == addr)
                return true;

    return false;
}
function normalizeStatus(status) {
    var tokens = status.split(' ');
    if (tokens.length)
        return tokens[0];

    return status;
}

function notify(toNotify) {
    var text = '';
    var emailTo = configuration.recipient.value.join(',');
    if (!toNotify.length)
        return;

    toNotify.forEach(function (i) {
        text += 'Node ' + i.stats.pxname + ':' + i.stats.svname + ' changed status from '
            + normalizeStatus(i.previousStats.status) + ' to '
            + normalizeStatus(i.stats.status) + '\n\r';
        i.notified = true;
    });

    transport.sendMail({
        from: 'haproxy-alerts@xpo.com',
        to: emailTo,
        subject: 'haproxy node status change alert',
        text: text
    }, function (err, info) {
        if (err) {
            console.log('email error: %s', err);
            toNotify.forEach(function (i) {i.notified = false});
        }
    });
}

function inspectStats() {

    var previousIsMaster = isMaster;
    isMaster = isMasterNode(configuration.vip.value); // ip needed
    if (previousIsMaster != isMaster) {
        // balancer status changed
    }

    if (!isMaster)
        return;

    var client = net.connect(configuration.socket.value, function () {
        client.write('show stat\r\n');
    });

    client.on('error', function (msg) {
        console.log('socket error: %s', msg);
    });

    client.on('data', function (msg) {
        var nodes = msg.toString().split('\n');
        var colData;
        var toNotify = [];

        nodes.forEach(function (n) {
            var columns = n.split(',').slice(0, -1);

            if (!columns.length) return;

            if (columns[0][0] == '#') { // header row
                columns[0] = columns[0].slice(2);
                colData = columns;
            } else {
                if (!colData)
                    return; // ??

                var record = {};

                columns.forEach(function (i, index) {
                    record[colData[index]] = i;
                });


                var key = record.pxname + record.svname;
                if (!nodeData[key])
                    nodeData[key] = { };

                var previousStats = nodeData[key].stats || record;

                if (normalizeStatus(previousStats.status) !== normalizeStatus(record.status))
                    toNotify.push(nodeData[key]); // will be updated below

                nodeData[key].stats         = record;
                nodeData[key].previousStats = previousStats
            }
        });

        //console.log('toNotify: %s', JSON.stringify(toNotify));
        notify(toNotify);
    });

}