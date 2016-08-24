var Repeat = require('repeat');
var request = require('request');
var _ = require('underscore');

// the kubernetes api cert in rancher is selfsigned and auto generated so we just have to ignore that when connecting to the kubernetes API
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

var SVC_POLL_INTERVAL = process.env.SVC_POLL_INTERVAL || 15;
var KUBE_SELECTOR = process.env.KUBE_SELECTOR ||  'type%3Dingress';
var KUBERNETES_SERVICE_PORT = process.env.KUBERNETES_SERVICE_PORT || '8080';
var KUBERNETES_SERVICE_HOST = process.env.KUBERNETES_SERVICE_HOST || 'localhost';
var PROTOCOL = 'https';
var KUBE_API_PATH = '/api';
var KUBE_API_URL = process.env.KUBE_API_URL || 'https://'+KUBERNETES_SERVICE_HOST+':'+KUBERNETES_SERVICE_PORT+ KUBE_API_PATH;
var KUBE_API_SERVICES = KUBE_API_URL +'/v1/services?labelSelector='+KUBE_SELECTOR;

var KUBE_APIS_PATH = '/apis';
var KUBE_APIS_URL = process.env.KUBE_APIS_URL || 'https://'+KUBERNETES_SERVICE_HOST+':'+KUBERNETES_SERVICE_PORT+ KUBE_APIS_PATH;
var KUBE_APIS_INGRESSES = KUBE_APIS_URL + '/extensions/v1beta1/ingresses'

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
var DOMAIN =  process.env.DOMAIN || 'service.consul';

// call the kubernetes API and get the list of services tagged
function checkServices() {
  console.log("requesting services from " + KUBE_API_SERVICES);

  var authObj = {user:KUBE_API_USER,pass:KUBE_API_PASSWORD};

  // call kubernetes API
  request({uri:KUBE_API_SERVICES,auth:authObj}, function (error, response, body) {

    if (!error && response.statusCode == 200) {
      var services = parseServicesJSON(JSON.parse(body));

      console.log(services);

      addServiceIngress(services);

    } else {
        console.log('status code'+response.statusCode +'error calling kubernetes API '+error)
    }

  })
};

function addServiceIngress(services) {
  console.log("adding services to ingress");
  var groupedServices = _.groupBy(services,'namespace')
  var keys = Object.keys( groupedServices );
  for( var i = 0,length = keys.length; i < length; i++ ) {
    var ingress = generateIngress(groupedServices[ keys[ i ] ]);
    var bodyStr = JSON.stringify(ingress);
    var INGRESS_REGISTER_URL = KUBE_APIS_URL + '/extensions/v1beta1/namespaces/'+ ingress.metadata.namespace+'/ingresses'
    var requestOpts = {url:INGRESS_REGISTER_URL,body:bodyStr};

    request.post(requestOpts, function (error, response, body) {
      console.log("Publish ingress to kubernetes - " + bodyStr);
      if (!error && response.statusCode == 200) {
        console.log('Ingress '+ ingress.metadata.name +' is created');
      } else {
        console.log('error adding ingress '+ ingress.metadata.name + ' to kubernetes.  Error: ' + error + ' Response:' + JSON.stringify(response));
      }
    })//request.post

  }//for
}

function generateIngress(groupedService) {
  var hosts = [];
  var namespace
  for(var i =0; i < groupedService.length;i++) {
    if(typeof(namespace)== 'undefined') {
      namespace = groupedService[i].namespace;
    }
    namespace = groupedService[i].namespace
    //console.log(groupedService[i])
    hosts.push({
      host: groupedService[i].name + '.' + groupedService[i].namespace + '.' + DOMAIN,
      http: {
        paths: [{
          backend: {
            serviceName: groupedService[i].name,
            servicePort: groupedService[i].port
          }
        }]
      }
    });
  }

  var ingress = {
    "apiVersion": "extensions/v1beta1",
    "kind": "Ingress",
    "metadata": {
      "namespace": namespace,
      "name": "test-" + namespace
    },
    "spec": {
      "rules": hosts
    }
  }
  return ingress;
}

// call the kubernetes API and get the list of ingresses tagged
function checkIngresses() {
  console.log("requesting ingresses from " + KUBE_APIS_INGRESSES);

  var authObj = {user:KUBE_API_USER,pass:KUBE_API_PASSWORD};

  // call kubernetes API
  request({uri:KUBE_APIS_INGRESSES,auth:authObj}, function (error, response, body) {

    if (!error && response.statusCode == 200) {
      var ingresses = parseIngressesJSON(JSON.parse(body));

      console.log(ingresses);

      // add service into consul
      for(var i = 0; i < ingresses.length;i++) {
        publishIngressToConsul(ingresses[i]);
      }

    } else {
        console.log('status code'+response.statusCode +'error calling kubernetes API '+error)
    }

  })
};




// Parse the JSON returned from the kubernetes service API and extract the information we need.
function parseServicesJSON(serviceList) {

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

// Parse the JSON returned from the kubernetes service API and extract the information we need.
function parseIngressesJSON(ingressesList) {

  var ingresses= [];

  for(var i =0; i < ingressesList.items.length;i++) {

    if(!ingressesList.items[i].status.loadBalancer){
      console.log('no load balancer assigned to ingress '+ ingressesList.items[i].metadata.name + ' skipping');
      continue;
    }

    // process all rules in each ingress looking for hosts to register DNS entries for
    for(var j=0;j < ingressesList.items[i].spec.rules.length;j++) {
      if(ingressesList.items[i].spec.rules[j].host && ingressesList.items[i].status.loadBalancer.ingress){

        var ingress = {
          name: ingressesList.items[i].metadata.name,
          namespace: ingressesList.items[i].metadata.namespace,
          host: ingressesList.items[i].spec.rules[j].host,
          ip: ingressesList.items[i].status.loadBalancer.ingress[0].ip
        }

        ingresses.push(ingress);
      }//if
    }//for
  }//for
  return ingresses;
}


function publishIngressToConsul(ingress){
  var labels = ingress.host.split(".");

  if(!ingress.host.endsWith(DOMAIN)){
    console.log('Ingress host names must end with '+DOMAIN);
    return;
  }

  if(labels.length < 3) {
    console.log("hostnames must be made up of at least 3 labels e.g. label1.label2."+DOMAIN);
    return;
  }

  var consulSvc = {
                    id: ingress.host,
                    name: labels[1],
                    tags: [labels[0]],
                    port: 80,
                    address:ingress.ip
                  };

    var bodyStr=JSON.stringify(consulSvc);
    var requestOpts = {url:CONSUL_API_ADDRESS,body:bodyStr};

    console.log("Going to publish to consul:" + bodyStr);

    if(typeof(CONSUL_API_TOKEN)!== 'undefined') {

      requestOpts.headers = { 'X-Consul-Token': CONSUL_API_TOKEN }
    }

    // call consul API
    request.put(requestOpts, function (error, response, body) {
      console.log("Publish service to consul");

      if (!error && response.statusCode == 200) {

        console.log('service ' + ingress.host +' registered in consul and directing to ' + ingress.ip + " on port 80");

      } else {
          console.log('error adding service '+ingress.host+' to consul: '+error+' response:' + JSON.stringify(response));
      }

    })
}


// Poll the kubernetes API for new services
// TODO we should be able to make this event based.
Repeat(checkServices).every(SVC_POLL_INTERVAL, 'sec').start.in(2, 'sec');
Repeat(checkIngresses).every(SVC_POLL_INTERVAL, 'sec').start.in(3, 'sec');
