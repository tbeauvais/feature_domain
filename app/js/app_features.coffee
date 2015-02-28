
angular.module('sampleDomainApp').factory 'AppFeatures',  ($q, Model) ->

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
      if targetInstance.inputs.page_location
        feature.inputs.page_location.target = targetInstance.inputs.page_location.target
        feature.inputs.page_location.name = targetInstance.inputs.page_location.name
      else
        # TODO get these from page feature
        feature.inputs.page_location.target = '#page_container'
        feature.inputs.page_location.name = 'Page 1'

      @features().splice(index+1, 0, feature)
    else
      @features().push(feature)

    @saveFeatures()
    feature

  move: (sourceId, targetId, containerId) ->
    console.log("AppFeatures move '#{sourceId}' to '#{targetId}'")

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
    @model.features

  indexOfId: (id) ->
    @features().map((e) ->
      e.id).indexOf(id);

  loadModel: (id) ->
    deferred = $q.defer()
    @model = Model.get {uuid: id}, (model) =>
      deferred.resolve(model)
    deferred.promise

  setFeatures: (features) ->
    @app_features = features

  saveFeatures: ->
    console.log 'Saving feature instances'
    @model.$update {uuid: @model.id}

  app_features: null
  model: null
