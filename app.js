var Repeat = require('repeat');
var request = require('request');

// the kubernetes api cert in rancher is selfsigned and auto generated so we just have to ignore that when connecting to the kubernetes API
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

var SVC_POLL_INTERVAL = process.env.SVC_POLL_INTERVAL || 15;
var KUBE_SELECTOR = process.env.KUBE_SELECTOR ||  'type%3Dingress';
var KUBERNETES_SERVICE_PORT = process.env.KUBERNETES_SERVICE_PORT || '8080';
var KUBERNETES_SERVICE_HOST = process.env.KUBERNETES_SERVICE_HOST || 'localhost';
var PROTOCOL = 'https';
var KUBE_API_PATH = '/api';
var KUBE_API_URL = process.env.KUBE_API_URL || 'https://'+KUBERNETES_SERVICE_HOST+':'+KUBERNETES_SERVICE_PORT+ KUBE_API_PATH;
var KUBE_API = KUBE_API_URL +'/v1/services?labelSelector='+KUBE_SELECTOR;
var KUBE_API_PODS = KUBE_API_URL +'/v1/pods';
var DOMAIN =  process.env.DOMAIN || 'service.consul';
var ENVIRONMENT_NAME = process.env.ENVIRONMENT_NAME || 'test';
var KUBE_API_USER = process.env.KUBE_API_USER || '';
var KUBE_API_PASSWORD = process.env.KUBE_API_PASSWORD || '';
var CONSUL_API_ADDRESS = process.env.CONSUL_API_ADDRESS || 'http://kubernetes';
var CONSUL_API_TOKEN = process.env.CONSUL_API_TOKEN;
var POD_NAME = process.env.POD_NAME;
var DOCKER_HOST_IP = process.env.DOCKER_HOST_IP;
var DOCKER_POD_IP = process.env.DOCKER_POD_IP;
var VULCAND_HOST_PORT = process.env.VULCAND_HOST_PORT || 80;

// call the kubernetes API and get the list of services tagged
function checkServices() {
  console.log("requesting services from " + KUBE_API);

  var authObj = {user:KUBE_API_USER,pass:KUBE_API_PASSWORD};

  // call kubernetes API
  request({uri:KUBE_API,auth:authObj}, function (error, response, body) {

    if (!error && response.statusCode == 200) {
      var services = parseJSON(JSON.parse(body));

      console.log(services);

      // add service into etcd backend for vulcand
      // addServiceBackends(services);

    } else {
        console.log('status code'+response.statusCode +'error calling kubernetes API '+error)
    }

  })
};

// Parse the JSON returned from the kubernetes service API and extract the information we need.
function parseJSON(serviceList) {

  var services= [];

  for(var i =0; i < serviceList.items.length;i++) {

    var service = {
      name: serviceList.items[i].metadata.name,
      namespace: serviceList.items[i].metadata.namespace,
      port: serviceList.items[i].spec.ports[0].port,
      ip: serviceList.items[i].spec.clusterIP,
      annotations: serviceList.items[i].metadata.annotations
    }

    services.push(service);
  }

  return services;
}

// Poll the kubernetes API for new services
// TODO we should be able to make this event based.
Repeat(checkServices).every(SVC_POLL_INTERVAL, 'sec').start.in(2, 'sec');
