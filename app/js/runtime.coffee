
angular.module('sampleDomainApp').factory 'DataResource', ($http) ->

  get: (url, callback) ->
    $http.get(url).success (data) ->
      console.log "data #{data}"


angular.module('sampleDomainApp').directive 'serviceResource', (DataResource) ->
  restrict: 'AEC',
  replace: true,
  template: '<div></div>',
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    DataResource.get('https://query.yahooapis.com/v1/public/yql?q=select%20item.condition%20from%20weather.forecast%20where%20woeid%20%3D%2091560673&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys')
