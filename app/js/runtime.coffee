
angular.module('sampleDomainApp').factory 'DataResource', ($http) ->

  get: (url, resource, target) ->
    $http.get(url).success (data) ->
      resource[target] = data

  delete: (url, get_url, resource, target) ->
    console.log 'hit delete 1'
    $http.delete(url).success (data) ->
      console.log 'hit delete 2'
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
    deleteResourceCleanup = scope.$parent.$on 'deleteResource', (event, deleteUrl) ->
      console.log 'hit delete 0'
      DataResource.delete(deleteUrl, scope.url, scope.$parent.DataResource, scope.target)
    postResourceCleanup = scope.$parent.$on 'postResource', (event, form, data) ->
      DataResource.post(scope.url, data, scope.$parent.DataResource, scope.target)

    # remove listeners when directive is destroyed
    elem.on '$destroy', ->
      console.log 'hit $destroy'
      deleteResourceCleanup()
      postResourceCleanup()

angular.module('sampleDomainApp').directive 'googleChart', (DataResource) ->
  restrict: 'AEC',
  replace: true,
  template: "<img src='https://chart.googleapis.com/chart?chs={{width}}x{{height}}&chd=t:{{chd}}&cht={{type}}&chl={{chl}}&chds=0,500&chco={{color}}&chbh=a,5' alt='chart' class='img-responsive {{align}}' >",

  scope:
    type: '@'
    color: '@'
    target: '@'
    width: '@'
    height: '@'
    field: '@'
    label: '@'
    align: '@'

  link: (scope, elem, attrs) ->
    scope.chd = ''
    scope.chl = ''
    scope.chl = ''

    scope.$watch '$parent.' + scope.target, (newValue, oldValue) ->
      if (newValue)
        scope.chd = _.map(newValue, (item) ->
          item[scope.field] + ''
        ).join()
        scope.chl = _.map(newValue, (item) ->
          item[scope.label]
        ).join('|')

    # remove watch when directive is destroyed
    elem.on '$destroy', ->
      console.log 'hit $destroy'
