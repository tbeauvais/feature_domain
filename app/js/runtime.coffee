
angular.module('sampleDomainApp').factory 'DataResource', ($http) ->

  get: (url, resource, target) ->
    $http.get(url).success (data) ->
      resource[target] = data

  delete: (url, get_url, resource, target) ->
    $http.delete(url).success (data) ->
      # TODO do something on failure (error event?)
      $http.get(get_url).success (data) ->
        resource[target] = data

  post: (url, data, resource, target) ->
    $http({
      method: 'POST'
      url: url
      data: $.param(data)
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}
    }).success (data) ->
      # TODO do something on failure (error event?)
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
    # TODO make unique name based on feature instance
    scope.$parent.$on 'deleteResource', (event, deleteUrl) ->
      DataResource.delete(deleteUrl, scope.url, scope.$parent.DataResource, scope.target)
    scope.$parent.$on 'postResource', (event, form, data) ->
      DataResource.post(scope.url, data, scope.$parent.DataResource, scope.target)
