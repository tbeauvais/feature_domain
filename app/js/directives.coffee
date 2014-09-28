angular.module('sampleDomainApp').directive 'featureList', (Features, AppFeatures) ->
  restrict: 'AEC',
  replace: true,
  template: '<ul class="list" ui-sortable="sortableOptions" ng-model="features"><li class="item" ng-repeat="feature in features"><feature-item></li></ul>',

  link: (scope, elem, attrs) ->
    scope.$on 'addFeature', (event, featureName) ->
      featureInstance = Features.createFeatureInstance(featureName+'Feature')
      AppFeatures.add(featureInstance)
      # using parent scope so apply and generate are on the parent
      scope.$apply()
      # function on controller
      scope.generate()
      scope.$broadcast('featureSelected', featureInstance.id);

angular.module('sampleDomainApp').directive 'featureItem', ($rootScope, Features, AppFeatures) ->
  restrict: 'AEC',
  replace: true,
  template: '<div><div class="pull-left"><span class="glyphicon {{glyphicon}}"></span></div><span class="feature">{{feature.inputs.name}}</span><span class="pull-right feature-delete glyphicon glyphicon-remove-circle"></span></div>',
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
        AppFeatures.delete(scope.feature.id)
        # using parent scope so apply and generate are on the parent
        scope.$apply()
        # function on controller
        scope.generate()
        $rootScope.$broadcast('featureNotSelected')
      e.preventDefault()
      false
    scope.$on 'featureSelected', (event, featureId) ->
       if featureId == scope.feature.id
         elem.parent().addClass('highlight_feature')
       else
         elem.parent().removeClass('highlight_feature')
       true

angular.module('sampleDomainApp').directive 'featureEditor', ($compile, $templateCache, Features, AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: '<div>Select feature from list to edit its properties...<div>',
  # use parent scope
  scope: true,

  link: (scope, elem, attrs) ->
    scope.$on 'featureSelected', (event, featureId) ->
      featureMetadata = AppMetadata.getFeature(featureId)
      # TODO clean up this reference (featureMetadata.model.instance.feature)
      feature = Features.getFeature(featureMetadata.model.instance.feature)

      # TODO move this so the editor doesn't know about the content section
      $('#content_section .highlight_feature').removeClass('highlight_feature')
      $("#content_section #" + featureMetadata.model.page_info.id).addClass('highlight_feature')

      scope.inputs = {}
      scope.featureId = featureId
      inputs = []
      inputs.push("<h2>#{feature.name}</h2>")
      inputs.push("<form id='edit_form' role='form' ng-submit='submit()' ng-controller='EditorCtrl' >")
      for input in feature.inputs
        console.log input
        inputs.push("<div class='form-group' >")
        inputs.push("  <label>#{input.label}</label>")
        scope.inputs[input.name] = featureMetadata.model.instance.inputs[input.name]
        # TODO don't hard code this
        if input.name == 'page_location'
          inputs.push("  <input class='page-target-selector' />")
        else
          inputs.push("  <input name='#{input.name}' placeholder='#{input.placeholder}' ng-model='inputs.#{input.name}' class='form-control' />")

        inputs.push("</div>")

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


angular.module('sampleDomainApp').directive 'pageTargetSelector', (AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  # target.model.name group by target.parent.model.name for target in targets
  template: "<div class='control-group'><select ng-options='page for page in pages' ng-model='inputs.page_location.name' class='form-control page-select' /><select ng-options='target.model.name group by target.parent.model.name for target in targets' ng-model='selectedTarget' class='form-control page-select'/></div>",
  # use parent scope
  scope: false

  link: (scope, elem, attrs) ->
    scope.pages = AppMetadata.getPages()
    scope.targets = AppMetadata.getPageTargets('Page 1')
    target = _.find scope.targets, (target) ->
      scope.inputs.page_location.target == target.model.name


    scope.selectedTarget = target


angular.module('sampleDomainApp').directive 'addFeature', (Features) ->
  restrict: 'AEC',
  replace: true,
  template: '<div class="btn-group">' +
      '<button type="button" class="btn btn-default dropdown-toggle" data-toggle="dropdown">Add Feature ' +
        '<span class="caret"></span>' +
      '</button>' +
      '<ul class="dropdown-menu" role="menu" ng-model="features">' +
        '<li ng-repeat="feature in features"><add-feature-item/></li>' +
      '</ul>' +
    '</div>',
  # use new scope
  scope: true,

  link: (scope, elem, attrs) ->
    scope.features = Features.getFeatures()


angular.module('sampleDomainApp').directive 'addFeatureItem',  ->
  restrict: 'AEC',
  replace: true,
  template: '<a href="#">{{feature.name}}</a>'
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    elem.bind 'click', (e) ->
      scope.$root.$broadcast('addFeature', e.target.innerText)
      e.preventDefault()
      true


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
      height = 500 - margin.top - margin.bottom
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
