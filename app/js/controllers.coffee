angular.module('sampleDomainApp').controller 'FeaturesCtrl', ($scope, AppFeatures, AppMetadata) ->

  $scope.generate = ->
    $scope.$root.$broadcast('generateContent', AppFeatures.features())

  $scope.sortableOptions =
    stop: (e, ui) ->
      $scope.generate()

  $scope.onDropComplete = (event, index, featureType, featureInstance) ->
    console.log("dropped '#{featureType}' on, '#{featureInstance.inputs.name}'")
    $scope.$root.$broadcast('addFeature', featureType, featureInstance.id)
    false

  $scope.onDropFromContent = (event, index, channel, source, target) ->
    target = target.toString()
    console.log("onDropFromContent from '#{source}' to '#{target}'")

    if channel == 'A'
        $scope.$root.$broadcast('addFeature', source, target)
        return

    source = source.toString()

    return false if source == target

    if AppMetadata.isChildOfOnPage(target, source)
      console.log "onDropFromContent aborted because of circular reference moving #{source} to #{target}"
      return false

    console.log("onDropFromContent moveFeature from '#{source}' to '#{target}'")
    $scope.$root.$broadcast('moveFeature', source, target)
    false

  $scope.onDropFromContentInContainer = (event, index, sourceId, targetId, containerId) ->
    console.log("onDropFromContentInContainer called for container #{containerId} '#{sourceId}' to '#{targetId}'")
    sourceId = sourceId.toString()
    targetId = targetId.toString()
    return false if sourceId == targetId

    if AppMetadata.isChildOfOnPage(targetId, sourceId)
      console.log "onDropFromContentInContainer aborted because of circular reference moving #{sourceId} to #{targetId}"
      return false

    console.log("onDropFromContentInContainer from '#{sourceId}' to '#{targetId}'")
    $scope.$root.$broadcast('moveFeature', sourceId, targetId, containerId)
    false

  $scope.toggleMetadata = false

angular.module('sampleDomainApp').controller 'EditorCtrl', ($scope, AppFeatures, AppMetadata) ->

  $scope.submit =  ->
    features = AppFeatures.features()
    featureInstance = features.filter( (feature) ->
      $scope.featureId == feature.id
    )[0]

    highlighted = $('#content_section .highlight_feature')

    id = highlighted[0].id if highlighted.length > 0

    featureInstance.inputs = $scope.inputs

    # TODO move highlight to feature generation (i.e. add class there)
    $("#content_section #" + "#{id}").addClass('highlight_feature') if id
    AppFeatures.saveFeatures()
    $scope.$root.$broadcast('featureUpdated', featureInstance.id)
    true


angular.module('sampleDomainApp').factory 'Models', ($resource) ->
  $resource '/api/v1/models'

angular.module('sampleDomainApp').factory 'Model', ($resource) ->
  $resource '/api/v1/models/:uuid', {}, {
    update:
      method : 'PUT'
  }

angular.module('sampleDomainApp').controller 'ModelCtrl', ($scope,  $location, $window, Models, Model, AppFeatures) ->

  Models.query (models) ->
    if $scope.currentModelId
      $scope.currentModel = _.find models, (model) ->
        $scope.currentModelId == model.id

    $scope.currentModel = models[0] unless $scope.currentModel
    $scope.models = models
    $scope.load($scope.currentModel)

  $scope.load = (model) ->
    $location.path("/models/#{model.id}", false)
    $location.replace()
    AppFeatures.loadModel(model.id).then ->
      $scope.$root.features = AppFeatures.features()
      $scope.$root.$broadcast('generateContent', AppFeatures.features())
      $scope.saveAsModelName = model.name

  $scope.save = (model)->
    updated_model = model
    updated_model['features'] = AppFeatures.features()
    Model.update {uuid: model.id}, JSON.stringify(updated_model)

  $scope.saveAs = (model)->
    new_model = model
    new_model['features'] = AppFeatures.features()
    new_model.name = $scope.saveAsModelName
    Model.save JSON.stringify(new_model), (model)->
      new_model.id = model.id
      $location.path("/models/#{model.id}", false)

  $scope.delete = (model)->
    if confirm('Are you sure you want to delete this application')
      Model.delete {uuid: model.id}
      Models.query (models) ->
        $scope.currentModel = models[0]
        $scope.saveAsModelName = $scope.currentModel.name
        $scope.models = models
        $location.path("/models/#{$scope.currentModel.id}", false)

  $scope.preview = (model)->
    $window.open("/models/#{model.id}/preview")
    true
