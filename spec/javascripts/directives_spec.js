(function(){

  describe('directive: featureList', function () {
    var element, scope;

    beforeEach(module('sampleDomainApp'));

    beforeEach(inject(function($rootScope, $compile) {
      scope = $rootScope.$new();

      element = '<div class="feature-list"></div>';

      element = $compile(element)(scope);
      scope.$digest();
    }));

    it("adds an unordered list element", function() {
      expect(element[0].tagName).toEqual('UL');
    });

    it("creates a repeat for features", function() {
      expect(element[0].innerHTML).toEqual('<!-- ngRepeat: feature in features track by feature.id -->');
    });

    it('adds features to model attribute', function() {
      expect(element[0].getAttribute('ng-model')).toEqual('features');
    });

    it('makes features sortable', function() {
      expect(element[0].getAttribute('ui-sortable')).toEqual('sortableOptions');
    });


  });

  describe('directive: featureItem', function () {
    var element, scope;

    beforeEach(module('sampleDomainApp'));

    beforeEach(inject(function($rootScope, $compile) {
      scope = $rootScope.$new();

      element = '<feature-item>';

      scope.feature = {feature: 'TextFeature', inputs: {name: 'My Text'}};

      element = $compile(element)(scope);
      scope.$digest();
    }));

    it("adds proper content", function() {
      var content = '<div class="pull-left"><span class="glyphicon glyphicon-pencil"></span></div>' +
        '<span class="feature ng-binding">My Text</span>' +
        '<span class="pull-right feature-copy glyphicon glyphicon-share" title="Copy"></span>' +
        '<span class="pull-right feature-delete glyphicon glyphicon-remove-circle" title="Delete"></span>';
      expect(element[0].innerHTML).toEqual(content);
    });

  });


  describe('directive: featureEditor', function () {
    var element, scope, editor, compiler;

    beforeEach(module('sampleDomainApp'));

    beforeEach(inject(function($rootScope, $compile, AppMetadata, AppFeatures) {
      AppMetadata.reset();
      scope = $rootScope.$new();

      editor = '<div class="feature-editor"></div>';

      AppMetadata.addPage('Page 1', 'Page 1');
      AppMetadata.addPageTarget('Page 1', '#content_section');
      instance = {id: '3', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      AppMetadata.addFeature({id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}});


      var app_features = [{id: '1', inputs: {page_location: {target: '#content_section', name: 'Page 1'}}}, {id: '2', inputs: {page_location: {target: '#content_section', name: 'Page 1'}}}];
      AppFeatures.features = function() {
        return app_features
      };
      AppFeatures.saveFeatures = function() {
      };
      AppFeatures.add(instance, '2');

      compiler = $compile;
      element = $compile(editor)(scope);
      scope.$digest();
    }));

    it("adds proper content when no feature selected", function() {
      var content = '<div class="feature-editor ng-scope">Select feature from list to edit its properties...<div></div></div>';
      expect(element[0].outerHTML).toEqual(content);
    });

    describe('when feature selected', function () {

      it("form has 4 inputs", function () {
        scope.$broadcast('featureSelected', '3');
        expect(element.find('input').length).toEqual(4);
      });

      it("adds select to pick page", function () {
        scope.$broadcast('featureSelected',  '3');
        expect(element.find('select:first option').text()).toEqual('Page 1');
      });

      it("adds select to pick target", function () {
        scope.$broadcast('featureSelected',  '3');
        expect(element.find('select:last option:last').text()).toEqual('#content_section');
      });

    });
  });

})();
