angular.module('sampleDomainApp').controller 'FeaturesCtrl', ($scope, Features, AppFeatures, AppGenerate, AppMetadata) ->

  $scope.getFeatures = ->
    AppFeatures.loadFeatures().success (data) ->
      $scope.features = data
      $scope.generate()

  $scope.generate = ->
    AppGenerate.generate($scope.features, $scope)
    AppGenerate.compile($scope)

  $scope.sortableOptions =
    stop: (e, ui) ->
      $scope.generate()

  $scope.onDropComplete = (event, index, feature, featureInstance) ->
    console.log("dropped '#{feature.name}' on, '#{featureInstance.inputs.name}'")
    $scope.$root.$broadcast('addFeature', feature.name, featureInstance.id)
    false

  $scope.onDropFromContent = (event, index, channel, source, target) ->

    if channel == 'A'
      debugger
      $scope.$root.$broadcast('addFeature', source.name, target)
      return

    return if source == target
    console.log("onDropFromContent from '#{source}' to '#{target}'")
    $scope.$root.$broadcast('moveFeature', source, target)
    false

  $scope.onDropFromContentInContainer = (event, index, source, target, containerId) ->
    return if source == target
    console.log("onDropFromContentInContainer from '#{source}' to '#{target}'")
    $scope.$root.$broadcast('moveFeature', source, target, containerId)
    false

  $scope.getFeatures()

  $scope.toggleMetadata = true

angular.module('sampleDomainApp').controller 'EditorCtrl', ($scope, AppFeatures, AppGenerate) ->

  $scope.submit =  ->
    features = AppFeatures.features()
    featureInstance = features.filter( (feature) ->
      $scope.featureId == feature.id
    )[0]

    highlighted = $('#content_section .highlight_feature')

    id = highlighted[0].id if highlighted.length > 0

    featureInstance.inputs = $scope.inputs
    # TODO need a way to map inputs
    featureInstance.inputs.page_location.target = $scope.selectedTarget.model.name
    AppGenerate.generate(features, $scope)
    AppGenerate.compile($scope)
    # TODO move highlight to feature generation (i.e. add class there)
    $("#content_section #" + "#{id}").addClass('highlight_feature') if id
    AppFeatures.saveFeatures()
    true
