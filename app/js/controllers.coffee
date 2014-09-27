angular.module('sampleDomainApp').controller 'FeaturesCtrl', ($scope, AppFeatures, AppGenerate) ->

  $scope.getFeatures = ->
    AppFeatures.loadFeatures().success (data) ->
      $scope.features = data
      $scope.generate()

  $scope.generate = ->
    AppGenerate.generate($scope.features, $scope)
    AppGenerate.compile($scope)

  $scope.sortableOptions =
    stop: ->
      $scope.generate()

  $scope.getFeatures()


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
    true
