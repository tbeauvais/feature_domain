angular.module('sampleDomainApp').controller 'FeaturesCtrl', ($scope, AppFeatures, AppGenerate) ->

  $scope.features = AppFeatures.features()

  $scope.generate = ->
    AppGenerate.generate(this.features, $scope)
    AppGenerate.compile($scope)

  $scope.generate()

  $scope.sortableOptions =
    stop: ->
      $scope.generate()


angular.module('sampleDomainApp').controller 'EditorCtrl', ($scope, AppFeatures, AppGenerate) ->


  $scope.submit =  ->
    features = AppFeatures.features()
    featureInstance = features.filter( (feature) ->
      $scope.featureId == feature.id
    )[0]

    highlighted = $('#content_section .highlight_feature')

    id = highlighted[0].id if highlighted.length > 0

    featureInstance.inputs = $scope.inputs
    AppGenerate.generate(features, $scope)
    AppGenerate.compile($scope)
    # TODO move highlight to feature generation (i.e. add class there)
    $("#content_section ##{id}").addClass('highlight_feature') if id
    true

