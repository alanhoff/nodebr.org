var express = require('express');
var level = require('level');
var http = require('http');
var sockjs = require('sockjs');
var Puid = require('puid');
var bodyParser = require('body-parser');
var validator = require('validator');

var db = level('./db', {
    valueEncoding : 'json'
});
var app = express();
var server = http.createServer(app);
var clients = {};
var puid = new Puid();
var votes = [];

app.get('/', function(req, res, next){
    res.sendfile(__dirname + '/template/main.html');
});

app.get('/api/ideia', function(req, res, next){
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.write('[');

    var count = 0;
    db.createReadStream()
        .on('data', function(data){
            if(count++ > 0)
                res.write(',');

            data.value.id = data.key;
            res.write(JSON.stringify(data.value));
        })
        .on('end', function(){
            res.write(']');
            res.end();
        });
});

app.post('/api/ideia', bodyParser.json(), function(req, res, next){
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    var errors = [];

    if(!validator.isLength(req.body.titulo, 1, 80))
        errors.push('Seu título deve ter entre 1 e 80 caracteres.');

    if(!validator.isLength(req.body.descricao, 1, 500))
        errors.push('A descrição deve ter entre 1 e 500 caracteres.');

    if(req.body.autor && !validator.isLength(req.body.autor, 1, 30))
        errors.push('O seu nome deve ter entre 1 e 30 caracteres.');

    if(errors.length)
        return res.send(400, JSON.stringify(errors));

    var model = {
        titulo : req.body.titulo,
        descricao : req.body.descricao,
        autor : req.body.autor || '',
        data : new Date().toString(),
        karma : 0
    };

    var id = puid.generate();
    db.put(id, model, function(err){
        if(err)
            return next(err);

        res.send(200, JSON.stringify({id : id}));

        Object.keys(clients).forEach(function(id){
            clients[id].write('u');
        });
    });
});

app.get('/api/karma/:id/:bit', function(req, res, next){
    var voter = new Date().toString(); //(req.headers['x-forwarded-for'] || req.connection.remoteAddress) + req.params.id;

    if(votes.indexOf(voter) !== -1)
        return res.send(403);

    db.get(req.params.id, function(err, doc){
        if(err)
            return next(err);

        if(Number(req.params.bit))
            doc.karma++;
        else
            doc.karma--;

        db.put(req.params.id, doc, function(err){
            if(err)
                return next(err);

            res.send(200);
            votes.push(voter);

            Object.keys(clients).forEach(function(id){
                clients[id].write('u');
            });
        });
    });
});

app.all('*', function(req, res, next){
    res.statusCode = 404;
    res.sendfile(__dirname + '/template/404.html');
});

app.use(function(err, req, res, next){
    console.error(err.stack);
    res.send(500, 'Alguma coisa está estragada!');
});

var socket = sockjs.createServer();
socket.installHandlers(server, {
    prefix : '/update'
});

socket.on('connection', function(conn){
    clients[conn.id] = conn;

    conn.on('close', function(){
        delete clients[conn.id];
    });
});

server.listen(8081);
