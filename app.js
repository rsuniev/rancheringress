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

var DOMAIN =  process.env.DOMAIN || 'service.consul';
var ENVIRONMENT_NAME = process.env.ENVIRONMENT_NAME || 'test';
var KUBE_API_USER = process.env.KUBE_API_USER || '';
var KUBE_API_PASSWORD = process.env.KUBE_API_PASSWORD || '';
var CONSUL_API_ADDRESS = process.env.CONSUL_API_ADDRESS || 'http://kubernetes';
var CONSUL_API_TOKEN = process.env.CONSUL_API_TOKEN;
var DOCKER_HOST_IP = process.env.DOCKER_HOST_IP;
var DOCKER_POD_IP = process.env.DOCKER_POD_IP;
var DOMAIN =  process.env.DOMAIN || 'service.consul';

// call the kubernetes API and get the list of services tagged
function checkServices() {
  var authObj = {user:KUBE_API_USER,pass:KUBE_API_PASSWORD};

  // call kubernetes API
  request({uri:KUBE_API_SERVICES,auth:authObj}, function (error, response, body) {

    if (!error && response.statusCode == 200) {
      var services = parseServicesJSON(JSON.parse(body));

      console.log("Services found: " + JSON.stringify(services));

      addServiceIngress(services);

    } else {
      console.log('status code'+response.statusCode +'error calling kubernetes API '+error)
    }

  })
};

function addServiceIngress(services) {
  var groupedServices = _.groupBy(services,'namespace')
  var keys = Object.keys( groupedServices );
  for( var i = 0,length = keys.length; i < length; i++ ) {
    var data = generateIngressHosts(groupedServices[ keys[ i ] ]);
    var ingressName = 'test-'+data.namespace;
    console.log('ingressName' + ingressName);
    var ingressNamespace = data.namespace;
    console.log('ingressNamespace' + ingressNamespace);
    var hosts = data.hosts;
    if(isIngressExist(ingressName,ingressNamespace)){
      console.log('ingress exists');
      patchIngress(ingressName,ingressNamespace,hosts);
    }else{
      console.log('ingress does not exist. creating');
      createIngress(ingressName, ingressNamespace,hosts)
    }
  }//for
}

function isIngressExist(ingressName, ingressNamespace){
  var INGRESS_READ_URL = KUBE_APIS_URL + '/extensions/v1beta1/namespaces/'+ ingressNamespace+'/ingresses/' + ingressName;
  console.log('checking isIngressExist: ' + INGRESS_READ_URL);
  request.get(INGRESS_READ_URL, function (err, res, body) {
    if (!err && res.statusCode == 200) {
      console.log('Ingress found');
      return true;
    } else{
      console.log('Ingress is found');
      return false;
    }
  });
}


function createIngress(ingressName, ingressNamespace,hosts){
  var ingress = {
       "apiVersion": "extensions/v1beta1",
       "kind": "Ingress",
       "metadata": {
         "namespace": ingressNamespace,
         "name": ingressName
       },
       "spec": {
         "rules": hosts
       }
     }
  var bodyStr = JSON.stringify(ingress);
  var INGRESS_REGISTER_URL = KUBE_APIS_URL + '/extensions/v1beta1/namespaces/'+ ingressNamespace+'/ingresses'
  var requestOpts = {url:INGRESS_REGISTER_URL,body:bodyStr};

  request.post(requestOpts, function (error, response, body) {
    console.log("Publish ingress to kubernetes - " + bodyStr);
    if (!error && response.statusCode == 201) {
      console.log('Ingress '+ ingress.metadata.name +' is created');
    } else{
      console.log('error adding ingress '+ ingress.metadata.name + ' to kubernetes.  Error: ' + error + ' Response:' + JSON.stringify(response));
    }
  });
}

function patchIngress(ingressName, ingressNamespace,hosts){
  var ingress = {"spec": {"rules": hosts}};

  var bodyStr = JSON.stringify(ingress);
  var INGRESS_REGISTER_URL = KUBE_APIS_URL + '/extensions/v1beta1/namespaces/'+ ingressNamespace+'/ingresses'
  var requestOpts = {url:INGRESS_REGISTER_URL,body:bodyStr};

  requestOpts = {url:INGRESS_REGISTER_URL + "/" + ingressName, body:bodyStr};
  request.patch(requestOpts, function (error, response, body){
    if (response.statusCode !== 200) {
      console.log('error updating ingress '+ ingressName + ' to kubernetes.  Error: ' + error + ' Response:' + JSON.stringify(response));
    }else{
      console.log('Ingress '+ ingressName +' is updated');
    }
  });//request.patch
}


function publishIngress(ingress){
  var bodyStr = JSON.stringify(ingress);
  var INGRESS_REGISTER_URL = KUBE_APIS_URL + '/extensions/v1beta1/namespaces/'+ ingress.metadata.namespace+'/ingresses'
  var requestOpts = {url:INGRESS_REGISTER_URL,body:bodyStr};

  request.post(requestOpts, function (error, response, body) {
    console.log("Publish ingress to kubernetes - " + bodyStr);
    if (!error && response.statusCode == 201) {
      console.log('Ingress '+ ingress.metadata.name +' is created');
    } else if (response.statusCode == 409) {
      console.log('Ingress ' + ingress.metadata.name + ' already exist. Going to replace');
      requestOpts = {url:INGRESS_REGISTER_URL + "/" + ingress.metadata.name, body:bodyStr};
      request.put(requestOpts, function (error1, response1, body1){
        if (response1.statusCode !== 200) {
          console.log('error updating ingress '+ ingress.metadata.name + ' to kubernetes.  Error: ' + error1 + ' Response:' + JSON.stringify(response1));
        }else{
          console.log('Ingress '+ ingress.metadata.name +' is updated');
        }
      })//request.post
    } else {
      console.log('error adding ingress '+ ingress.metadata.name + ' to kubernetes.  Error: ' + error + ' Response:' + JSON.stringify(response));
    }
  })//request.put
}

function generateIngressHosts(groupedService){
  var hosts = [];
  var namespace;
  for(var i =0; i < groupedService.length;i++) {
    namespace = groupedService[i].namespace;
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
  return {
    hosts: hosts,
    namespace: namespace
  };
}

// call the kubernetes API and get the list of ingresses tagged
function checkIngresses() {
  console.log("requesting ingresses from " + KUBE_APIS_INGRESSES);

  var authObj = {user:KUBE_API_USER,pass:KUBE_API_PASSWORD};

  // call kubernetes API
  request({uri:KUBE_APIS_INGRESSES,auth:authObj}, function (error, response, body) {

    if (!error && response.statusCode == 200) {
      var ingresses = parseIngressesJSON(JSON.parse(body));

      console.log("Ingress found: " + JSON.stringify(ingresses));

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
