
angular.module('sampleDomainApp').factory 'AppFeatures',  ($http) ->

  find: (id) ->
    _.find this.features(), (feature) ->
      id == feature.id

  delete: (id) ->
    index = 0
    features = this.features()
    while index < features.length && features[index].id != id
      index += 1

    this.saveFeatures()
    features.splice(index, 1)

  add: (feature, targetId) ->
    feature.id = this.nextIndex()

    if targetId
      index = this.indexOfId(targetId)
      this.features().splice(index+1, 0, feature)
    else
      this.features().push(feature)

    this.saveFeatures()
    feature

  move: (sourceId, targetId) ->
    sourceIndex = this.indexOfId(sourceId)
    targetIndex = this.indexOfId(targetId)
    this.features().splice(targetIndex, 0, this.features().splice(sourceIndex, 1)[0]);
    # do nothing

  nextIndex:  ->
    index = 0
    features = this.features()
    for feature in features
      id = parseInt(feature.id)
      index = id if id > index

    (index + 1)+""

  features: ->
    this.app_features

  indexOfId: (id) ->
    this.features().map((e) ->
      e.id).indexOf(id);

  loadFeatures: ->
    results = $http.get('/api/app_features');
    results.success (data) =>
      this.app_features = data
    results

  saveFeatures: ->
    $http.post('/api/app_features', JSON.stringify(this.app_features))

  app_features: null
