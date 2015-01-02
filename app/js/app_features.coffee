
angular.module('sampleDomainApp').factory 'AppFeatures',  ($http) ->

  find: (id) ->
    _.find @features(), (feature) ->
      id == feature.id

  delete: (id) ->
    index = 0
    features = @features()
    while index < features.length && features[index].id != id
      index += 1

    features.splice(index, 1)
    @saveFeatures()

  add: (feature, targetId) ->
    feature.id = @nextIndex()

    if targetId
      index = @indexOfId(targetId)
      targetInstance = @find(targetId)
      feature.inputs.page_location = {target: '', name: ''}
      feature.inputs.page_location.target = targetInstance.inputs.page_location.target
      feature.inputs.page_location.name = targetInstance.inputs.page_location.name
      @features().splice(index+1, 0, feature)
    else
      @features().push(feature)

    @saveFeatures()
    feature

  move: (sourceId, targetId, containerId) ->
    sourceIndex = @indexOfId(sourceId)
    targetIndex = @indexOfId(targetId)
    sourceInstance = @find(sourceId)
    targetInstance = @find(targetId)
    sourceInstance.inputs.page_location.name = targetInstance.inputs.page_location.name
    if containerId
      sourceInstance.inputs.page_location.target = '#' + containerId
    else
      sourceInstance.inputs.page_location.target = targetInstance.inputs.page_location.target
    @features().splice(targetIndex, 0, @features().splice(sourceIndex, 1)[0]);
    @saveFeatures()

  nextIndex:  ->
    index = 0
    features = @features()
    for feature in features
      id = parseInt(feature.id)
      index = id if id > index

    (index + 1)+""

  features: ->
    @app_features

  indexOfId: (id) ->
    @features().map((e) ->
      e.id).indexOf(id);

  loadFeatures: ->
    results = $http.get('/api/app_features');
    results.success (data) =>
      @app_features = data
    results

  saveFeatures: ->
    $http.post('/api/app_features', JSON.stringify(@app_features))

  app_features: null
