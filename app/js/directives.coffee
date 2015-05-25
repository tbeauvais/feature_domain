angular.module('sampleDomainApp').directive 'featureList', ($rootScope, Features, AppFeatures) ->
  restrict: 'AEC',
  replace: true,
  template: '<ul class="list" ui-sortable="sortableOptions" ng-model="features" ><li drop-channel="A" ui-on-drop="onDropComplete($event,$index,$data,feature)" class="item" ng-repeat="feature in features track by feature.id"><feature-item></li></ul>',
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    scope.$on 'addFeature', (event, featureName, targetId) ->
      targetId = targetId.toString()
      # TODO This should get passed a real feature ID (not featureName)
      featureInstance = Features.createFeatureInstance(featureName+'Feature')
      AppFeatures.add(featureInstance, targetId)
      scope.features = AppFeatures.features()
      scope.$apply()
      # function on controller
      scope.generate()
      scope.$broadcast('featureSelected', featureInstance.id);
    scope.$on 'moveFeature', (event, sourceId, targetId, containerId) ->
      sourceId = sourceId.toString()
      targetId = targetId.toString()
      AppFeatures.move(sourceId, targetId, containerId)
      scope.features = AppFeatures.features()
      scope.$apply()
      scope.generate()
      scope.$broadcast('featureSelected', targetId);
    scope.$on 'deleteFeature', (event, featureId) ->
      AppFeatures.delete(featureId)
      scope.features = AppFeatures.features()
      scope.$apply()
      scope.generate()
      scope.$broadcast('featureNotSelected')
    scope.$on 'featureUpdated', (event, featureId) ->
      # TODO caused feature instance list not to be updated when changing model
      #scope.features = AppFeatures.features()
      scope.generate()
    scope.$on 'copyFeature', (event, featureId) ->
      sourceInstance = AppFeatures.find(featureId)
      featureInstance = Features.createFeatureInstance(sourceInstance.feature)
      featureInstance.inputs = JSON.parse(JSON.stringify(sourceInstance.inputs))
      AppFeatures.add(featureInstance, featureId)
      scope.features = AppFeatures.features()
      scope.$apply()
      # function on controller
      scope.generate()
      scope.$broadcast('featureSelected', featureInstance.id);


angular.module('sampleDomainApp').directive 'featureItem', ($rootScope, Features, AppFeatures) ->
  restrict: 'AEC',
  replace: true,
  template: '<div><div class="pull-left"><span class="glyphicon {{glyphicon}}"></span></div><span class="feature">{{feature.inputs.name}}</span><span class="pull-right feature-copy glyphicon glyphicon-share" title="Copy" ></span><span class="pull-right feature-delete glyphicon glyphicon-remove-circle" title="Delete"></span></div>',
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    # TODO fix the feature.feature naming
    scope.glyphicon = Features.getFeature(scope.feature.feature).icon
    elem.bind 'click', (e) ->
      scope.$root.$broadcast('featureSelected', scope.feature.id)
      e.preventDefault()
      false
    elem.find('.feature-delete').bind 'click', (e) ->
      # TODO Use angular bootstrap confirm dialog
      if confirm('Are you sure you want to delete this feature')
        $rootScope.$broadcast('deleteFeature', scope.feature.id)
      e.preventDefault()
      false
    elem.find('.feature-copy').bind 'click', (e) ->
      $rootScope.$broadcast('copyFeature', scope.feature.id)
      e.preventDefault()
      false
    scope.$on 'featureSelected', (event, featureId) ->
       if featureId == scope.feature.id
         elem.parent().addClass('highlight_feature')
       else
         elem.parent().removeClass('highlight_feature')
       true

angular.module('sampleDomainApp').directive 'featureEditor', ($compile, $templateCache, Features, AppFeatures, AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: '<div>Select feature from list to edit its properties...<div>',
  # don't use parent scope
  scope: true,

  link: (scope, elem, attrs) ->
    scope.$on 'featureSelected', (event, featureId) ->
      featureInstance = AppFeatures.find(featureId)
      feature = Features.getFeature(featureInstance.feature)

      scope.feature = feature
      scope.inputs = {}
      scope.featureId = featureId
      inputs = []
      inputs.push("<h3>#{feature.name}</h2>")
      inputs.push("<form id='edit_form' role='form' ng-submit='submit()' ng-controller='EditorCtrl' >")
      scope.inputs = featureInstance.inputs
      for input in feature.inputs
        inputs.push("  <div class='#{input.control}' feature='feature' inputs='inputs' model='inputs.#{input.name}' name='#{input.name}' />")

      inputs.push("<input type='submit' id='submit' value='Submit' class='btn btn-default' />")
      inputs.push("</form>")

      elem.html(inputs.join(''))
      html = $(elem.find('#edit_form'))
      $compile(html)(scope)
      # process model data {{foo}} (i.e. through watchers)
      scope.$apply()
    true
    scope.$on 'featureNotSelected', (event) ->
      elem.empty()
      $templateCache.get('')
      # TODO how do we share this with template:
      elem.html('<div>Select feature from list to edit its properties...<div>')
      scope.$apply()


angular.module('sampleDomainApp').directive 'paletteList', (Features) ->
  restrict: 'AEC',
  replace: true,
  template: '<ul class="list" ng-model="features"><li ui-draggable="true" drag="featureType.name" drag-channel="A" class="item" ng-repeat="featureType in features track by featureType.name"><palette-item></li></ul>',
  # use new scope
  scope: true,

  link: (scope, elem, attrs) ->
    scope.features = Features.getFeatures()


angular.module('sampleDomainApp').directive 'paletteItem', ($rootScope, Features, AppFeatures) ->
  restrict: 'AEC',
  replace: true,
  template: '<div><div class="pull-left"><span class="glyphicon {{glyphicon}}"></span></div><span class="feature">{{featureType.name}}</span></div>',
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    scope.glyphicon = scope.featureType.icon

angular.module('sampleDomainApp').directive 'generatedContent', ($compile, Features, AppMetadata, AppFeatures) ->
  restrict: 'C',
  replace: false,
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    scope.DataResource = {} unless scope.DataResource

    if scope.designMode
      elem.bind 'click', (e) ->
        id = $(e.target).closest('[id]').attr('id')
        feature = _.find AppMetadata.getFeatures(), (feature) ->
          if feature.page_info
            feature.page_info.id == id
          else
            false
        if feature
          scope.$root.$broadcast('featureSelected', feature.id)
        e.preventDefault()
        false
      scope.$on 'featureSelected', (event, featureId) ->

        # TODO cleanup
        original = $('#content_section .highlight_feature')
        if original && original.length > 0
          original.removeClass('highlight_feature')
          # TODO Find a better way to get originalFeatureId
          originalFeatureId = original.attr('drag')
          id = original.attr('id')

          featureMetadata = AppMetadata.getFeature(originalFeatureId)
          featureInstance = AppFeatures.find(originalFeatureId)
          if featureMetadata
            feature = Features.getFeature(featureInstance.feature)

            if feature.visual_editor
              # remove the visual editor
              if feature.visual_editor.target
                target = original.find(feature.visual_editor.target)
              else
                target = original

              target.unwrap()

              original.empty()

              # update the real feature instance inputs
              featureInstance.inputs = scope.featureInstance.inputs
              inputs = JSON.parse(JSON.stringify(scope.featureInstance.inputs))
              inputs.page_location.target = '#' + "#{id}"

              # perform partial generation
              generator = new AppGenerate(AppFeatures)
              generator.generateInstance(featureInstance, inputs, Features, AppMetadata)

              $compile(original)(scope)


        featureMetadata = AppMetadata.getFeature(featureId)
        featureInstance = AppFeatures.find(featureId)

        if featureMetadata && featureMetadata.page_info
          feature = Features.getFeature(featureInstance.feature)
          target = $("#content_section #" + featureMetadata.page_info.id)
          target.addClass('highlight_feature')

          if feature.visual_editor
            scope.featureInstance = featureInstance
            scope.feature = feature
            if feature.visual_editor.target
              target = target.find(feature.visual_editor.target)
            directive = $("<div class='#{feature.visual_editor.control}' feature='feature' feature-instance='featureInstance' ></div>")
            target.wrap(directive)
            $compile(target.parent())(scope)

        true

    scope.$on 'generateContent', (event, features) ->
      elem.find('#content_section').empty()
      generator = new AppGenerate()
      generator.generate(features, Features, AppMetadata)
      html = elem.find('#content_section')
      $compile(html)(scope)
      scope.$root.$broadcast('postGenerate')
      event.preventDefault()
      false

angular.module('sampleDomainApp').directive 'renderMetaData', (AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: '<div>Metadata</div>'
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->

    render = ->
      margin =
        top: 20
        right: 10
        bottom: 20
        left: 100

      width = 2110 - margin.right - margin.left
      height = 1500 - margin.top - margin.bottom
      i = 0
      tree = d3.layout.tree().size([height, width])
      diagonal = d3.svg.diagonal().projection((d) ->
        [
          d.y
          d.x
        ]
      )
      svg = d3.select(elem[0]).append("svg").attr("width", width + margin.right + margin.left).attr("height", height + margin.top + margin.bottom).append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")")

      root = AppMetadata.getRoot()

      # Compute the new tree layout.
      nodes = tree.nodes(root.model).reverse()
      links = tree.links(nodes)

      # Normalize for fixed-depth.
      nodes.forEach (d) ->
        d.y = d.depth * 175
        return

      # Declare the nodes…
      node = svg.selectAll("g.node").data nodes, (d) ->
        d.id or (d.id = ++i)

      # Enter the nodes.
      nodeEnter = node.enter().append("g").attr("class", "node").attr "transform", (d) ->
        "translate(" + d.y + "," + d.x + ")"

      nodeEnter.append("circle").attr("r", 10).style("fill", "#fff").attr("data-feature-instance-id", (d) ->
        # TODO find consistent way of getting id
        if d.page_info
          d.id
        else if d.feature_instance_id
          d.feature_instance_id
        else
          ''
      )
      nodeEnter.append("text").attr("x", (d) ->
        (if d.children or d._children then -13 else 13)
      ).attr("dy", ".35em").attr("text-anchor", (d) ->
        (if d.children or d._children then "end" else "start")
      ).text((d) ->
        d.name
      ).style "fill-opacity", 1

      # Declare the links…
      link = svg.selectAll("path.link").data links, (d) ->
        d.target.id

      # Enter the links.
      link.enter().insert("path", "g").attr("class", "link").attr "d", diagonal

    render()
    scope.$on 'postGenerate', (event) ->
      elem.empty()
      render()

    elem.bind 'click', (e) ->
      featureId = e.target.getAttribute('data-feature-instance-id');
      scope.$broadcast('featureSelected', featureId) if featureId

    scope.$on 'featureSelected', (event, featureId) ->
      $('.render-meta-data .highlight_metadata').attr('class', '')
      #featureMetadata = AppMetadata.getFeature(featureId)
      $('.render-meta-data').find("[data-feature-instance-id='#{featureId}']").attr('class','highlight_metadata')

    true
