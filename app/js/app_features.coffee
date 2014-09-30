
angular.module('sampleDomainApp').factory 'AppFeatures',  ($http) ->

  find: (id) ->
    _.find this.features(), (feature) ->
      id == feature.id

  delete: (id) ->
    index = 0
    features = this.features()
    while index < features.length && features[index].id != id
      index += 1

    features.splice(index, 1)

  add: (feature) ->
    feature.id = this.nextIndex()
    this.features().push(feature)
    feature

  nextIndex:  ->
    index = 0
    features = this.features()
    for feature in features
      id = parseInt(feature.id)
      index = id if id > index

    (index + 1)+""

  features: ->
    this.app_features


  loadFeatures: ->
    results = $http.get('/api/app_features');
    results.success (data) =>
      this.app_features = data
    results

  saveFeatures: ->
    $http.post('/api/app_features', JSON.stringify(this.app_features))

  app_features: null
