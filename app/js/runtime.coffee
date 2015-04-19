
angular.module('sampleDomainApp').factory 'DataResource', ($http) ->

  get: (url, resource, target) ->
    $http.get(url).success (data) ->
      resource[target] = data


angular.module('sampleDomainApp').directive 'serviceResource', (DataResource) ->
  restrict: 'AEC',
  replace: true,
  template: '<div></div>',

  scope:
    resource: '='
    url: '@'
    target: '@'

  link: (scope, elem, attrs) ->
    DataResource.get(scope.url, scope.$parent.DataResource, scope.target)
